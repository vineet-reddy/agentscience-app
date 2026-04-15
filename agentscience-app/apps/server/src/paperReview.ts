import Mime from "@effect/platform-node/Mime";
import { spawnSync } from "node:child_process";
import type { Dirent } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

import {
  type PaperReviewArtifact,
  paperReviewFileRoutePath,
  type PaperReviewCompileState,
  type PaperReviewCompilerKind,
  type PaperReviewPreview,
  type PaperReviewSnapshot,
  ThreadId,
} from "@agentscience/contracts";
import { Effect, Layer, ServiceMap } from "effect";

import { resolveThreadWorkspaceCwd } from "./checkpointing/Utils";
import { runProcess } from "./processRunner";
import { OrchestrationEngineService } from "./orchestration/Services/OrchestrationEngine";
import type { OrchestrationEngineShape } from "./orchestration/Services/OrchestrationEngine";

type ResolvedPaperReviewThread = {
  readonly id: ThreadId;
  readonly title: string;
  readonly workspaceRoot: string | null;
};

type ExistingArtifact = PaperReviewArtifact & {
  readonly absolutePath: string;
  readonly updatedAtMs: number;
};

type CompileSessionState = {
  status: PaperReviewCompileState["status"];
  lastBuiltAt: string | null;
  lastError: string | null;
  outputExcerpt: string | null;
  inFlightBuild: Promise<void> | null;
};

type ResolvedCompiler =
  | {
      kind: Exclude<PaperReviewCompilerKind, "none">;
      label: string;
      command: string;
      pathDir?: string;
      bibtexCommand?: string;
    }
  | {
      kind: "none";
      label: null;
    };

export interface PaperReviewServiceShape {
  readonly getSnapshot: (threadId: ThreadId) => Effect.Effect<PaperReviewSnapshot>;
  readonly compile: (threadId: ThreadId) => Effect.Effect<PaperReviewSnapshot>;
  readonly resolveFilePath: (
    threadId: ThreadId,
    relativePath: string,
  ) => Effect.Effect<string | null>;
}

export class PaperReviewService extends ServiceMap.Service<
  PaperReviewService,
  PaperReviewServiceShape
>()("agentscience/PaperReviewService") {}

const SOURCE_PRIORITY = ["paper.tex", "paper.md"] as const;
const NOTES_PRIORITY = ["figure-descriptions.md", "experiment-log.md"] as const;
const BIB_PRIORITY = ["references.bib"] as const;
const FIGURES_DIRNAME = "figures";
const PAPER_TOOLCHAIN_ENV_DIR = "AGENTSCIENCE_PAPER_TOOLCHAIN_DIR";
const PAPER_TOOLCHAIN_DIRNAME = "paper-toolchain";
const BUILD_OUTPUT_EXCERPT_MAX_CHARS = 6_000;

function managedExecutableName(name: string): string {
  return process.platform === "win32" ? `${name}.exe` : name;
}

function platformArchKey(): string {
  return `${process.platform}-${process.arch}`;
}

function unique<T>(values: readonly T[]): T[] {
  return Array.from(new Set(values));
}

function trimExcerpt(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  if (!normalized) {
    return null;
  }
  if (normalized.length <= BUILD_OUTPUT_EXCERPT_MAX_CHARS) {
    return normalized;
  }
  return `${normalized.slice(0, BUILD_OUTPUT_EXCERPT_MAX_CHARS - 4)}\n...`;
}

function managedToolchainRoots(): string[] {
  const processWithResourcesPath = process as NodeJS.Process & {
    resourcesPath?: string;
  };
  return unique(
    [
      process.env[PAPER_TOOLCHAIN_ENV_DIR]?.trim() ?? "",
      processWithResourcesPath.resourcesPath
        ? path.join(
            processWithResourcesPath.resourcesPath,
            "managed-resources",
            PAPER_TOOLCHAIN_DIRNAME,
          )
        : "",
      path.join(process.cwd(), "apps", "desktop", "managed-resources", PAPER_TOOLCHAIN_DIRNAME),
      path.join(process.cwd(), "managed-resources", PAPER_TOOLCHAIN_DIRNAME),
    ].filter((candidate) => candidate.length > 0),
  );
}

function resolveManagedBinary(name: string): { command: string; pathDir: string } | null {
  const executableName = managedExecutableName(name);
  const platformKey = platformArchKey();

  for (const root of managedToolchainRoots()) {
    for (const candidateDir of [
      path.join(root, platformKey, "bin"),
      path.join(root, "bin"),
      path.join(root, platformKey),
      root,
    ]) {
      const command = path.join(candidateDir, executableName);
      try {
        const result = spawnSync(command, ["--version"], {
          stdio: "ignore",
          shell: process.platform === "win32",
        });
        if (!result.error) {
          return {
            command,
            pathDir: candidateDir,
          };
        }
      } catch {
        // Ignore missing or invalid managed binaries and fall back.
      }
    }
  }

  return null;
}

function systemCommandExists(command: string, versionArg: string): boolean {
  try {
    const result = spawnSync(command, [versionArg], {
      stdio: "ignore",
      shell: process.platform === "win32",
    });
    return !result.error;
  } catch {
    return false;
  }
}

function resolveCompiler(): ResolvedCompiler {
  const managedLatexmk = resolveManagedBinary("latexmk");
  const managedPdflatex = resolveManagedBinary("pdflatex");
  const managedBibtex = resolveManagedBinary("bibtex");

  if (managedLatexmk && managedPdflatex) {
    return {
      kind: "managed-latexmk",
      label: "Bundled paper engine",
      command: managedLatexmk.command,
      pathDir: managedLatexmk.pathDir,
    };
  }

  if (managedPdflatex) {
    return {
      kind: "managed-pdflatex",
      label: "Bundled paper engine",
      command: managedPdflatex.command,
      pathDir: managedPdflatex.pathDir,
      ...(managedBibtex ? { bibtexCommand: managedBibtex.command } : {}),
    };
  }

  if (systemCommandExists("latexmk", "-v")) {
    return {
      kind: "system-latexmk",
      label: "System LaTeX",
      command: "latexmk",
    };
  }

  if (systemCommandExists("pdflatex", "--version")) {
    return {
      kind: "system-pdflatex",
      label: "System LaTeX",
      command: "pdflatex",
      ...(systemCommandExists("bibtex", "--version") ? { bibtexCommand: "bibtex" } : {}),
    };
  }

  return {
    kind: "none",
    label: null,
  };
}

async function statIfFile(absolutePath: string): Promise<{
  readonly sizeBytes: number;
  readonly updatedAtMs: number;
} | null> {
  try {
    const result = await fs.stat(absolutePath);
    if (!result.isFile()) {
      return null;
    }
    return {
      sizeBytes: result.size,
      updatedAtMs: result.mtimeMs,
    };
  } catch {
    return null;
  }
}

async function readTopLevelEntries(workspaceRoot: string): Promise<string[]> {
  try {
    return await fs.readdir(workspaceRoot);
  } catch {
    return [];
  }
}

function toContentType(relativePath: string): string {
  return Mime.getType(relativePath) ?? "application/octet-stream";
}

function toIsoDateTime(ms: number): string {
  return new Date(ms).toISOString();
}

async function toArtifact(
  threadId: ThreadId,
  workspaceRoot: string,
  relativePath: string,
  input: {
    readonly kind: PaperReviewArtifact["kind"];
    readonly label: string;
  },
): Promise<ExistingArtifact | null> {
  const absolutePath = path.join(workspaceRoot, relativePath);
  const fileInfo = await statIfFile(absolutePath);
  if (!fileInfo) {
    return null;
  }
  return {
    kind: input.kind,
    label: input.label,
    relativePath,
    url: paperReviewFileRoutePath(threadId, relativePath),
    sizeBytes: fileInfo.sizeBytes,
    updatedAt: toIsoDateTime(fileInfo.updatedAtMs),
    updatedAtMs: fileInfo.updatedAtMs,
    absolutePath,
    contentType: toContentType(relativePath),
  };
}

async function discoverSourceArtifact(
  threadId: ThreadId,
  workspaceRoot: string,
): Promise<ExistingArtifact | null> {
  for (const relativePath of SOURCE_PRIORITY) {
    const artifact = await toArtifact(threadId, workspaceRoot, relativePath, {
      kind: relativePath.endsWith(".tex") ? "latex" : "markdown",
      label: "Manuscript",
    });
    if (artifact) {
      return artifact;
    }
  }

  const topLevelEntries = await readTopLevelEntries(workspaceRoot);
  const latexCandidate = topLevelEntries
    .filter((entry) => entry.toLowerCase().endsWith(".tex"))
    .sort((left, right) => left.localeCompare(right))[0];
  if (latexCandidate) {
    return toArtifact(threadId, workspaceRoot, latexCandidate, {
      kind: "latex",
      label: "Manuscript",
    });
  }

  const markdownCandidate = topLevelEntries
    .filter(
      (entry) =>
        entry.toLowerCase().endsWith(".md") && !NOTES_PRIORITY.includes(entry as (typeof NOTES_PRIORITY)[number]),
    )
    .sort((left, right) => left.localeCompare(right))[0];
  if (markdownCandidate) {
    return toArtifact(threadId, workspaceRoot, markdownCandidate, {
      kind: "markdown",
      label: "Manuscript",
    });
  }

  return null;
}

async function discoverPdfArtifact(
  threadId: ThreadId,
  workspaceRoot: string,
  sourceArtifact: ExistingArtifact | null,
): Promise<ExistingArtifact | null> {
  const topLevelEntries = await readTopLevelEntries(workspaceRoot);
  const candidates = unique(
    [
      sourceArtifact ? `${path.basename(sourceArtifact.relativePath, path.extname(sourceArtifact.relativePath))}.pdf` : "",
      "paper.pdf",
      ...topLevelEntries.filter((entry) => entry.toLowerCase().endsWith(".pdf")).sort(),
    ].filter((candidate) => candidate.length > 0),
  );

  for (const relativePath of candidates) {
    const artifact = await toArtifact(threadId, workspaceRoot, relativePath, {
      kind: "pdf",
      label: "Preview PDF",
    });
    if (artifact) {
      return artifact;
    }
  }

  return null;
}

async function discoverPriorityArtifact(
  threadId: ThreadId,
  workspaceRoot: string,
  priorities: readonly string[],
  input: {
    readonly kind: PaperReviewArtifact["kind"];
    readonly label: string;
  },
): Promise<ExistingArtifact | null> {
  for (const relativePath of priorities) {
    const artifact = await toArtifact(threadId, workspaceRoot, relativePath, input);
    if (artifact) {
      return artifact;
    }
  }
  return null;
}

async function newestFigureInputTime(workspaceRoot: string): Promise<number | null> {
  const figuresRoot = path.join(workspaceRoot, FIGURES_DIRNAME);
  const queue = [figuresRoot];
  let latest: number | null = null;

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) {
      continue;
    }

    let entries: Dirent[];
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const absolutePath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        queue.push(absolutePath);
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }
      const stat = await statIfFile(absolutePath);
      if (!stat) {
        continue;
      }
      latest = latest === null ? stat.updatedAtMs : Math.max(latest, stat.updatedAtMs);
    }
  }

  return latest;
}

async function newestSourceDependencyTime(input: {
  readonly workspaceRoot: string;
  readonly source: ExistingArtifact | null;
  readonly bibliography: ExistingArtifact | null;
  readonly notes: ExistingArtifact | null;
}): Promise<number | null> {
  const candidateTimes = [
    input.source?.updatedAtMs ?? null,
    input.bibliography?.updatedAtMs ?? null,
    input.notes?.updatedAtMs ?? null,
    await newestFigureInputTime(input.workspaceRoot),
  ].filter((value): value is number => value !== null);

  if (candidateTimes.length === 0) {
    return null;
  }

  return Math.max(...candidateTimes);
}

function previewForState(input: {
  readonly source: ExistingArtifact | null;
  readonly pdf: ExistingArtifact | null;
  readonly needsBuild: boolean;
  readonly compileStatus: PaperReviewCompileState["status"];
}): PaperReviewPreview {
  if (
    input.pdf &&
    (!input.needsBuild || input.compileStatus === "ready") &&
    input.compileStatus !== "error"
  ) {
    return {
      kind: "pdf",
      relativePath: input.pdf.relativePath,
      url: input.pdf.url,
      updatedAt: input.pdf.updatedAt,
    };
  }

  if (input.source) {
    return {
      kind: input.source.kind === "markdown" ? "markdown" : "latex",
      relativePath: input.source.relativePath,
      url: input.source.url,
      updatedAt: input.source.updatedAt,
    };
  }

  return {
    kind: "empty",
    relativePath: null,
    url: null,
    updatedAt: null,
  };
}

async function resolveThread(
  orchestrationEngine: OrchestrationEngineShape,
  threadId: ThreadId,
): Promise<ResolvedPaperReviewThread | null> {
  const readModel = await Effect.runPromise(orchestrationEngine.getReadModel());
  const thread = readModel.threads.find((entry) => entry.id === threadId);
  if (!thread) {
    return null;
  }

  return {
    id: thread.id,
    title: thread.title,
    workspaceRoot: resolveThreadWorkspaceCwd({ thread }) ?? null,
  };
}

async function inspectThreadWorkspace(
  thread: ResolvedPaperReviewThread,
  compileState: CompileSessionState | null,
): Promise<PaperReviewSnapshot> {
  const compiler = resolveCompiler();

  if (!thread.workspaceRoot) {
    return {
      threadId: thread.id,
      threadTitle: thread.title,
      workspaceRoot: null,
      source: null,
      pdf: null,
      bibliography: null,
      notes: null,
      preview: { kind: "empty", relativePath: null, url: null, updatedAt: null },
      compile: {
        status: "unavailable",
        compiler: "none",
        compilerLabel: null,
        canCompile: false,
        needsBuild: false,
        lastBuiltAt: compileState?.lastBuiltAt ?? null,
        lastError: compileState?.lastError ?? null,
        outputExcerpt: compileState?.outputExcerpt ?? null,
      },
      reviewRecommended: false,
    };
  }

  const source = await discoverSourceArtifact(thread.id, thread.workspaceRoot);
  const bibliography = await discoverPriorityArtifact(thread.id, thread.workspaceRoot, BIB_PRIORITY, {
    kind: "bibliography",
    label: "References",
  });
  const notes = await discoverPriorityArtifact(thread.id, thread.workspaceRoot, NOTES_PRIORITY, {
    kind: "notes",
    label: "Figure notes",
  });
  const pdf = await discoverPdfArtifact(thread.id, thread.workspaceRoot, source);
  const dependencyTime = await newestSourceDependencyTime({
    workspaceRoot: thread.workspaceRoot,
    source,
    bibliography,
    notes,
  });
  const parsedLastBuildAttemptAtMs = compileState?.lastBuiltAt
    ? Date.parse(compileState.lastBuiltAt)
    : Number.NaN;
  const lastBuildAttemptAtMs = Number.isFinite(parsedLastBuildAttemptAtMs)
    ? parsedLastBuildAttemptAtMs
    : null;
  const needsBuild =
    source?.kind === "latex" &&
    (pdf === null || (dependencyTime !== null && pdf.updatedAtMs < dependencyTime));
  const shouldShowBuildError =
    Boolean(compileState?.lastError) &&
    needsBuild &&
    dependencyTime !== null &&
    lastBuildAttemptAtMs !== null &&
    dependencyTime <= lastBuildAttemptAtMs;
  const inferredCompileStatus: PaperReviewCompileState["status"] = compileState?.inFlightBuild
    ? "compiling"
    : shouldShowBuildError
      ? "error"
      : needsBuild
        ? compiler.kind === "none"
          ? "unavailable"
          : "idle"
        : pdf
          ? "ready"
          : source?.kind === "latex" && compiler.kind === "none"
            ? "unavailable"
            : "idle";

  const compile: PaperReviewCompileState = {
    status: inferredCompileStatus,
    compiler: compiler.kind,
    compilerLabel: compiler.label,
    canCompile: compiler.kind !== "none" && source?.kind === "latex",
    needsBuild: Boolean(needsBuild),
    lastBuiltAt: compileState?.lastBuiltAt ?? pdf?.updatedAt ?? null,
    lastError: compileState?.lastError ?? null,
    outputExcerpt: compileState?.outputExcerpt ?? null,
  };

  return {
    threadId: thread.id,
    threadTitle: thread.title,
    workspaceRoot: thread.workspaceRoot,
    source,
    pdf,
    bibliography,
    notes,
    preview: previewForState({
      source,
      pdf,
      needsBuild: Boolean(needsBuild),
      compileStatus: compile.status,
    }),
    compile,
    reviewRecommended: Boolean(source || pdf),
  };
}

function compileEnv(pathDir: string | undefined): NodeJS.ProcessEnv | undefined {
  if (!pathDir) {
    return undefined;
  }
  return {
    ...process.env,
    PATH: `${pathDir}${path.delimiter}${process.env.PATH ?? ""}`,
  };
}

async function runLatexBuild(input: {
  readonly workspaceRoot: string;
  readonly source: ExistingArtifact;
  readonly bibliography: ExistingArtifact | null;
  readonly compiler: ResolvedCompiler & { kind: Exclude<PaperReviewCompilerKind, "none"> };
}): Promise<{ outputExcerpt: string | null }> {
  const env = compileEnv(input.compiler.pathDir);

  if (input.compiler.kind === "managed-latexmk" || input.compiler.kind === "system-latexmk") {
    const result = await runProcess(
      input.compiler.command,
      ["-pdf", "-interaction=nonstopmode", "-halt-on-error", input.source.relativePath],
      {
        cwd: input.workspaceRoot,
        env,
        maxBufferBytes: 2 * 1024 * 1024,
        outputMode: "truncate",
      },
    );
    return {
      outputExcerpt: trimExcerpt(`${result.stdout}\n${result.stderr}`),
    };
  }

  const baseArgs = ["-interaction=nonstopmode", "-halt-on-error", input.source.relativePath];
  const firstPass = await runProcess(input.compiler.command, baseArgs, {
    cwd: input.workspaceRoot,
    env,
    maxBufferBytes: 2 * 1024 * 1024,
    outputMode: "truncate",
  });
  let outputBuffer = `${firstPass.stdout}\n${firstPass.stderr}`;

  if (input.bibliography && input.compiler.bibtexCommand) {
    const bibtexResult = await runProcess(
      input.compiler.bibtexCommand,
      [path.basename(input.source.relativePath, path.extname(input.source.relativePath))],
      {
        cwd: input.workspaceRoot,
        env,
        maxBufferBytes: 2 * 1024 * 1024,
        outputMode: "truncate",
      },
    );
    outputBuffer += `\n${bibtexResult.stdout}\n${bibtexResult.stderr}`;

    const secondPass = await runProcess(input.compiler.command, baseArgs, {
      cwd: input.workspaceRoot,
      env,
      maxBufferBytes: 2 * 1024 * 1024,
      outputMode: "truncate",
    });
    outputBuffer += `\n${secondPass.stdout}\n${secondPass.stderr}`;
  }

  const finalPass = await runProcess(input.compiler.command, baseArgs, {
    cwd: input.workspaceRoot,
    env,
    maxBufferBytes: 2 * 1024 * 1024,
    outputMode: "truncate",
  });
  outputBuffer += `\n${finalPass.stdout}\n${finalPass.stderr}`;

  return {
    outputExcerpt: trimExcerpt(outputBuffer),
  };
}

function nextCompileState(existing: CompileSessionState | undefined): CompileSessionState {
  return (
    existing ?? {
      status: "idle",
      lastBuiltAt: null,
      lastError: null,
      outputExcerpt: null,
      inFlightBuild: null,
    }
  );
}

const makePaperReviewService = Effect.gen(function* () {
  const orchestrationEngine = yield* OrchestrationEngineService;
  const compileSessions = new Map<string, CompileSessionState>();

  const inspect = async (threadId: ThreadId): Promise<PaperReviewSnapshot> => {
    const thread = await resolveThread(orchestrationEngine, threadId);
    if (!thread) {
      return {
        threadId,
        threadTitle: "Paper",
        workspaceRoot: null,
        source: null,
        pdf: null,
        bibliography: null,
        notes: null,
        preview: { kind: "empty", relativePath: null, url: null, updatedAt: null },
        compile: {
          status: "unavailable",
          compiler: "none",
          compilerLabel: null,
          canCompile: false,
          needsBuild: false,
          lastBuiltAt: null,
          lastError: "Thread not found.",
          outputExcerpt: null,
        },
        reviewRecommended: false,
      };
    }
    return inspectThreadWorkspace(thread, compileSessions.get(threadId) ?? null);
  };

  const getSnapshot: PaperReviewServiceShape["getSnapshot"] = (threadId) =>
    Effect.tryPromise(() => inspect(threadId));

  const compile: PaperReviewServiceShape["compile"] = (threadId) =>
    Effect.tryPromise(async () => {
      const thread = await resolveThread(orchestrationEngine, threadId);
      if (!thread || !thread.workspaceRoot) {
        return inspect(threadId);
      }

      const initialSnapshot = await inspectThreadWorkspace(thread, compileSessions.get(threadId) ?? null);
      if (!initialSnapshot.source || initialSnapshot.source.kind !== "latex") {
        return initialSnapshot;
      }
      if (!initialSnapshot.compile.canCompile || initialSnapshot.compile.compiler === "none") {
        return initialSnapshot;
      }

      const compiler = resolveCompiler();
      if (compiler.kind === "none") {
        return initialSnapshot;
      }

      const source = await discoverSourceArtifact(thread.id, thread.workspaceRoot);
      if (!source || source.kind !== "latex") {
        return initialSnapshot;
      }
      const bibliography = await discoverPriorityArtifact(
        thread.id,
        thread.workspaceRoot,
        BIB_PRIORITY,
        {
          kind: "bibliography",
          label: "References",
        },
      );

      const state = nextCompileState(compileSessions.get(threadId));
      if (state.inFlightBuild) {
        await state.inFlightBuild;
        return inspect(threadId);
      }

      state.status = "compiling";
      state.lastError = null;
      state.outputExcerpt = null;
      const buildPromise = runLatexBuild({
        workspaceRoot: thread.workspaceRoot,
        source,
        bibliography,
        compiler,
      })
        .then((result) => {
          state.status = "ready";
          state.lastBuiltAt = new Date().toISOString();
          state.lastError = null;
          state.outputExcerpt = result.outputExcerpt;
        })
        .catch((error: unknown) => {
          state.status = "error";
          state.lastBuiltAt = new Date().toISOString();
          state.lastError =
            error instanceof Error ? error.message : "Paper build failed unexpectedly.";
          state.outputExcerpt = trimExcerpt(
            `${state.outputExcerpt ?? ""}\n${error instanceof Error ? error.stack ?? error.message : String(error)}`,
          );
        })
        .finally(() => {
          state.inFlightBuild = null;
        });

      state.inFlightBuild = buildPromise;
      compileSessions.set(threadId, state);
      await buildPromise;
      return inspect(threadId);
    });

  const resolveFilePath: PaperReviewServiceShape["resolveFilePath"] = (threadId, relativePath) =>
    Effect.tryPromise(async () => {
      const thread = await resolveThread(orchestrationEngine, threadId);
      if (!thread?.workspaceRoot) {
        return null;
      }

      const normalized = path.posix.normalize(relativePath.trim().replaceAll("\\", "/"));
      if (
        normalized.length === 0 ||
        normalized === "." ||
        normalized.startsWith("../") ||
        path.isAbsolute(normalized)
      ) {
        return null;
      }

      const absolutePath = path.resolve(thread.workspaceRoot, normalized);
      const relativeToRoot = path.relative(thread.workspaceRoot, absolutePath).replaceAll("\\", "/");
      if (
        relativeToRoot.length === 0 ||
        relativeToRoot === "." ||
        relativeToRoot.startsWith("../") ||
        path.isAbsolute(relativeToRoot)
      ) {
        return null;
      }

      const fileInfo = await statIfFile(absolutePath);
      return fileInfo ? absolutePath : null;
    });

  return {
    getSnapshot,
    compile,
    resolveFilePath,
  } satisfies PaperReviewServiceShape;
});

export const PaperReviewServiceLive = Layer.effect(PaperReviewService, makePaperReviewService);
