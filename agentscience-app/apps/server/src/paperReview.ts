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
import {
  PAPER_PRESENTED_ACTIVITY_KIND,
  parsePresentedManuscriptPayload,
  type PresentedManuscriptManifest,
} from "./paperPresentation.ts";
import { OrchestrationEngineService } from "./orchestration/Services/OrchestrationEngine";
import type { OrchestrationEngineShape } from "./orchestration/Services/OrchestrationEngine";

type ResolvedPaperReviewThread = {
  readonly id: ThreadId;
  readonly title: string;
  readonly workspaceRoot: string | null;
  readonly activities: ReadonlyArray<{
    readonly kind: string;
    readonly payload: unknown;
    readonly createdAt: string;
  }>;
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
const PAPER_TOOLCHAIN_ENV_BIN_DIR = "AGENTSCIENCE_PAPER_TOOLCHAIN_BIN_DIR";
const PAPER_TOOLCHAIN_DIRNAME = "paper-toolchain";
const BUILD_OUTPUT_EXCERPT_MAX_CHARS = 6_000;
const GENERATED_LATEX_ARTIFACT_SUFFIXES = [
  ".aux",
  ".bbl",
  ".bcf",
  ".blg",
  ".fdb_latexmk",
  ".fls",
  ".lof",
  ".log",
  ".lot",
  ".nav",
  ".out",
  ".run.xml",
  ".snm",
  ".synctex.gz",
  ".toc",
  ".vrb",
] as const;

function managedExecutableName(name: string): string {
  return process.platform === "win32" ? `${name}.exe` : name;
}

function platformArchKey(): string {
  return `${process.platform}-${process.arch}`;
}

function platformToolchainKeys(): string[] {
  return unique([
    platformArchKey(),
    ...(process.platform === "darwin" ? ["darwin-universal"] : []),
  ]);
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

function managedToolchainBinDirs(): string[] {
  const explicitBinDir = process.env[PAPER_TOOLCHAIN_ENV_BIN_DIR]?.trim() ?? "";
  if (explicitBinDir.length > 0) {
    return [explicitBinDir];
  }

  return unique(
    [
      ...managedToolchainRoots().flatMap((root) => {
        const platformKeys = platformToolchainKeys();
        return [
          ...platformKeys.map((platformKey) => path.join(root, platformKey, "bin")),
          path.join(root, "bin"),
          ...platformKeys.map((platformKey) => path.join(root, platformKey)),
          root,
        ];
      }),
    ].filter((candidate) => candidate.length > 0),
  );
}

function shouldUseOnlyManagedPaperToolchain(): boolean {
  const processWithResourcesPath = process as NodeJS.Process & {
    resourcesPath?: string;
  };
  return Boolean(
    process.env[PAPER_TOOLCHAIN_ENV_BIN_DIR]?.trim() ||
    process.env[PAPER_TOOLCHAIN_ENV_DIR]?.trim() ||
    processWithResourcesPath.resourcesPath,
  );
}

function resolveManagedBinary(name: string): { command: string; pathDir: string } | null {
  const executableName = managedExecutableName(name);

  for (const candidateDir of managedToolchainBinDirs()) {
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
  const managedTectonic = resolveManagedBinary("tectonic");
  const managedLatexmk = resolveManagedBinary("latexmk");
  const managedPdflatex = resolveManagedBinary("pdflatex");
  const managedBibtex = resolveManagedBinary("bibtex");

  if (managedTectonic) {
    return {
      kind: "managed-tectonic",
      label: "Bundled Tectonic",
      command: managedTectonic.command,
      pathDir: managedTectonic.pathDir,
    };
  }

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

  if (shouldUseOnlyManagedPaperToolchain()) {
    return {
      kind: "none",
      label: null,
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

async function statIfDirectory(absolutePath: string): Promise<boolean> {
  try {
    const result = await fs.stat(absolutePath);
    return result.isDirectory();
  } catch {
    return false;
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
        entry.toLowerCase().endsWith(".md") &&
        !NOTES_PRIORITY.includes(entry as (typeof NOTES_PRIORITY)[number]),
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
      sourceArtifact
        ? `${path.basename(sourceArtifact.relativePath, path.extname(sourceArtifact.relativePath))}.pdf`
        : "",
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

type WorkspaceArtifactSnapshot = {
  readonly source: ExistingArtifact | null;
  readonly pdf: ExistingArtifact | null;
  readonly bibliography: ExistingArtifact | null;
  readonly notes: ExistingArtifact | null;
};

async function discoverWorkspaceArtifacts(
  threadId: ThreadId,
  workspaceRoot: string,
): Promise<WorkspaceArtifactSnapshot> {
  const source = await discoverSourceArtifact(threadId, workspaceRoot);
  const bibliography = await discoverPriorityArtifact(threadId, workspaceRoot, BIB_PRIORITY, {
    kind: "bibliography",
    label: "References",
  });
  const notes = await discoverPriorityArtifact(threadId, workspaceRoot, NOTES_PRIORITY, {
    kind: "notes",
    label: "Figure notes",
  });
  const pdf = await discoverPdfArtifact(threadId, workspaceRoot, source);

  return {
    source,
    pdf,
    bibliography,
    notes,
  };
}

function resolveDescendantPathWithinRoot(input: {
  readonly root: string;
  readonly candidate: string;
  readonly allowRoot?: boolean;
}): string | null {
  const absolutePath = path.isAbsolute(input.candidate)
    ? path.resolve(input.candidate)
    : path.resolve(input.root, input.candidate);
  const relativePath = path.relative(input.root, absolutePath).replaceAll("\\", "/");

  if (relativePath.length === 0 || relativePath === ".") {
    return input.allowRoot ? absolutePath : null;
  }
  if (relativePath === ".." || relativePath.startsWith("../") || path.isAbsolute(relativePath)) {
    return null;
  }

  return absolutePath;
}

function relativePathWithinRoot(root: string, absolutePath: string): string | null {
  return (
    resolveDescendantPathWithinRoot({
      root,
      candidate: absolutePath,
      allowRoot: false,
    }) && path.relative(root, absolutePath).replaceAll("\\", "/")
  );
}

async function toArtifactFromAbsolutePath(
  threadId: ThreadId,
  workspaceRoot: string,
  absolutePath: string,
  input: {
    readonly kind: PaperReviewArtifact["kind"];
    readonly label: string;
  },
): Promise<ExistingArtifact | null> {
  const relativePath = relativePathWithinRoot(workspaceRoot, absolutePath);
  if (!relativePath) {
    return null;
  }
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

function latestPresentedManuscript(
  thread: ResolvedPaperReviewThread,
): PresentedManuscriptManifest | null {
  for (const activity of [...thread.activities].reverse()) {
    if (activity.kind !== PAPER_PRESENTED_ACTIVITY_KIND) {
      continue;
    }
    const presentation = parsePresentedManuscriptPayload(activity.payload);
    if (presentation) {
      return presentation;
    }
  }
  return null;
}

function resolvePresentedArtifactPath(input: {
  readonly threadWorkspaceRoot: string;
  readonly workspaceRoot: string | null;
  readonly presentedPath: string | undefined;
}): string | null {
  if (!input.presentedPath) {
    return null;
  }
  const baseRoot = input.workspaceRoot ?? input.threadWorkspaceRoot;
  return resolveDescendantPathWithinRoot({
    root: baseRoot,
    candidate: input.presentedPath,
    allowRoot: false,
  });
}

async function resolvePresentedWorkspaceRoot(input: {
  readonly threadWorkspaceRoot: string;
  readonly presentation: PresentedManuscriptManifest;
}): Promise<string | null> {
  const explicitWorkspaceRootCandidate = input.presentation.workspaceRoot
    ? resolveDescendantPathWithinRoot({
        root: input.threadWorkspaceRoot,
        candidate: input.presentation.workspaceRoot,
        allowRoot: true,
      })
    : null;
  const explicitWorkspaceRoot =
    explicitWorkspaceRootCandidate && (await statIfDirectory(explicitWorkspaceRootCandidate))
      ? explicitWorkspaceRootCandidate
      : null;
  if (explicitWorkspaceRoot) {
    return explicitWorkspaceRoot;
  }

  for (const presentedPath of [
    input.presentation.source,
    input.presentation.pdf,
    input.presentation.bibliography,
    input.presentation.notes,
  ]) {
    const absolutePath = resolvePresentedArtifactPath({
      threadWorkspaceRoot: input.threadWorkspaceRoot,
      workspaceRoot: explicitWorkspaceRoot,
      presentedPath,
    });
    if (!absolutePath) {
      continue;
    }
    const directory = path.dirname(absolutePath);
    if (await statIfDirectory(directory)) {
      return directory;
    }
  }

  return null;
}

async function resolvePresentedWorkspaceArtifacts(input: {
  readonly threadId: ThreadId;
  readonly threadWorkspaceRoot: string;
  readonly presentation: PresentedManuscriptManifest;
}): Promise<{
  readonly workspaceRoot: string;
  readonly source: ExistingArtifact | null;
  readonly pdf: ExistingArtifact | null;
  readonly bibliography: ExistingArtifact | null;
  readonly notes: ExistingArtifact | null;
} | null> {
  const workspaceRoot = await resolvePresentedWorkspaceRoot({
    threadWorkspaceRoot: input.threadWorkspaceRoot,
    presentation: input.presentation,
  });
  if (!workspaceRoot) {
    return null;
  }

  const explicitSourcePath = resolvePresentedArtifactPath({
    threadWorkspaceRoot: input.threadWorkspaceRoot,
    workspaceRoot,
    presentedPath: input.presentation.source,
  });
  const explicitPdfPath = resolvePresentedArtifactPath({
    threadWorkspaceRoot: input.threadWorkspaceRoot,
    workspaceRoot,
    presentedPath: input.presentation.pdf,
  });
  const explicitBibliographyPath = resolvePresentedArtifactPath({
    threadWorkspaceRoot: input.threadWorkspaceRoot,
    workspaceRoot,
    presentedPath: input.presentation.bibliography,
  });
  const explicitNotesPath = resolvePresentedArtifactPath({
    threadWorkspaceRoot: input.threadWorkspaceRoot,
    workspaceRoot,
    presentedPath: input.presentation.notes,
  });

  const source =
    (explicitSourcePath
      ? await toArtifactFromAbsolutePath(input.threadId, workspaceRoot, explicitSourcePath, {
          kind: explicitSourcePath.toLowerCase().endsWith(".md") ? "markdown" : "latex",
          label: "Manuscript",
        })
      : null) ?? (await discoverSourceArtifact(input.threadId, workspaceRoot));
  const bibliography =
    (explicitBibliographyPath
      ? await toArtifactFromAbsolutePath(input.threadId, workspaceRoot, explicitBibliographyPath, {
          kind: "bibliography",
          label: "References",
        })
      : null) ??
    (await discoverPriorityArtifact(input.threadId, workspaceRoot, BIB_PRIORITY, {
      kind: "bibliography",
      label: "References",
    }));
  const notes =
    (explicitNotesPath
      ? await toArtifactFromAbsolutePath(input.threadId, workspaceRoot, explicitNotesPath, {
          kind: "notes",
          label: "Figure notes",
        })
      : null) ??
    (await discoverPriorityArtifact(input.threadId, workspaceRoot, NOTES_PRIORITY, {
      kind: "notes",
      label: "Figure notes",
    }));
  const pdf =
    (explicitPdfPath
      ? await toArtifactFromAbsolutePath(input.threadId, workspaceRoot, explicitPdfPath, {
          kind: "pdf",
          label: "Preview PDF",
        })
      : null) ?? (await discoverPdfArtifact(input.threadId, workspaceRoot, source));

  if (!source && !pdf) {
    return null;
  }

  return {
    workspaceRoot,
    source,
    pdf,
    bibliography,
    notes,
  };
}

async function candidateManuscriptWorkspaceRoots(
  threadWorkspaceRoot: string,
): Promise<readonly string[]> {
  const nestedWorkspaceRoot = path.join(threadWorkspaceRoot, "workspace");
  const nestedManuscriptRoot = path.join(threadWorkspaceRoot, "manuscript");
  return unique(
    [
      (await statIfDirectory(nestedWorkspaceRoot)) ? nestedWorkspaceRoot : "",
      (await statIfDirectory(nestedManuscriptRoot)) ? nestedManuscriptRoot : "",
      threadWorkspaceRoot,
    ].filter((candidate) => candidate.length > 0),
  );
}

async function resolveManuscriptWorkspaceRoot(input: {
  readonly threadId: ThreadId;
  readonly threadWorkspaceRoot: string;
}): Promise<string> {
  for (const candidateWorkspaceRoot of await candidateManuscriptWorkspaceRoots(
    input.threadWorkspaceRoot,
  )) {
    const candidateArtifacts = await discoverWorkspaceArtifacts(
      input.threadId,
      candidateWorkspaceRoot,
    );
    if (candidateArtifacts.source || candidateArtifacts.pdf) {
      return candidateWorkspaceRoot;
    }
  }

  return input.threadWorkspaceRoot;
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

function sourceRelativeOutputPath(source: ExistingArtifact, extension: string): string {
  const normalizedSourcePath = source.relativePath.replaceAll("\\", "/");
  const sourceDir = path.posix.dirname(normalizedSourcePath);
  const sourceBase = path.posix.basename(
    normalizedSourcePath,
    path.posix.extname(normalizedSourcePath),
  );
  return sourceDir === "." ? `${sourceBase}${extension}` : `${sourceDir}/${sourceBase}${extension}`;
}

function workspaceRelativePath(workspaceRoot: string, candidate: string): string | null {
  const absolutePath = path.isAbsolute(candidate)
    ? path.resolve(candidate)
    : path.resolve(workspaceRoot, candidate);
  const relativePath = path.relative(workspaceRoot, absolutePath).replaceAll("\\", "/");
  if (
    relativePath.length === 0 ||
    relativePath === "." ||
    relativePath === ".." ||
    relativePath.startsWith("../") ||
    path.isAbsolute(relativePath)
  ) {
    return null;
  }
  return relativePath;
}

function isGeneratedLatexArtifact(relativePath: string, source: ExistingArtifact): boolean {
  const normalized = relativePath.replaceAll("\\", "/").toLowerCase();
  if (normalized === sourceRelativeOutputPath(source, ".pdf").toLowerCase()) {
    return true;
  }
  return GENERATED_LATEX_ARTIFACT_SUFFIXES.some((suffix) => normalized.endsWith(suffix));
}

async function newestRecorderInputTime(input: {
  readonly workspaceRoot: string;
  readonly source: ExistingArtifact;
}): Promise<number | null> {
  const flsPath = path.join(input.workspaceRoot, sourceRelativeOutputPath(input.source, ".fls"));
  let raw: string;
  try {
    raw = await fs.readFile(flsPath, "utf8");
  } catch {
    return null;
  }

  let latest: number | null = null;
  const seen = new Set<string>();
  for (const line of raw.split(/\r?\n/)) {
    if (!line.startsWith("INPUT ")) {
      continue;
    }
    const recordedPath = line.slice("INPUT ".length).trim();
    if (!recordedPath) {
      continue;
    }
    const relativePath = workspaceRelativePath(input.workspaceRoot, recordedPath);
    if (
      !relativePath ||
      seen.has(relativePath) ||
      isGeneratedLatexArtifact(relativePath, input.source)
    ) {
      continue;
    }
    seen.add(relativePath);
    const stat = await statIfFile(path.join(input.workspaceRoot, relativePath));
    if (!stat) {
      continue;
    }
    latest = latest === null ? stat.updatedAtMs : Math.max(latest, stat.updatedAtMs);
  }

  return latest;
}

async function newestLatexInputTime(input: {
  readonly workspaceRoot: string;
  readonly source: ExistingArtifact | null;
}): Promise<number | null> {
  if (!input.source || input.source.kind !== "latex") {
    return null;
  }

  const recorderInputTime = await newestRecorderInputTime({
    workspaceRoot: input.workspaceRoot,
    source: input.source,
  });
  if (recorderInputTime !== null) {
    return recorderInputTime;
  }

  return newestFigureInputTime(input.workspaceRoot);
}

async function newestSourceDependencyTime(input: {
  readonly workspaceRoot: string;
  readonly source: ExistingArtifact | null;
  readonly bibliography: ExistingArtifact | null;
}): Promise<number | null> {
  const candidateTimes = [
    input.source?.updatedAtMs ?? null,
    input.bibliography?.updatedAtMs ?? null,
    await newestLatexInputTime({
      workspaceRoot: input.workspaceRoot,
      source: input.source,
    }),
  ].filter((value): value is number => value !== null);

  if (candidateTimes.length === 0) {
    return null;
  }

  return Math.max(...candidateTimes);
}

function previewForState(input: {
  readonly source: ExistingArtifact | null;
  readonly pdf: ExistingArtifact | null;
}): PaperReviewPreview {
  if (input.pdf) {
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
    activities: thread.activities.map((activity) => ({
      kind: activity.kind,
      payload: activity.payload,
      createdAt: activity.createdAt,
    })),
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

  const presentedWorkspace = (() => {
    const presentation = latestPresentedManuscript(thread);
    if (!presentation) {
      return null;
    }
    return resolvePresentedWorkspaceArtifacts({
      threadId: thread.id,
      threadWorkspaceRoot: thread.workspaceRoot,
      presentation,
    });
  })();
  const resolvedPresentedWorkspace = presentedWorkspace ? await presentedWorkspace : null;
  const manuscriptWorkspaceRoot =
    resolvedPresentedWorkspace?.workspaceRoot ??
    (await resolveManuscriptWorkspaceRoot({
      threadId: thread.id,
      threadWorkspaceRoot: thread.workspaceRoot,
    }));

  const source =
    resolvedPresentedWorkspace?.source ??
    (await discoverSourceArtifact(thread.id, manuscriptWorkspaceRoot));
  const bibliography =
    resolvedPresentedWorkspace?.bibliography ??
    (await discoverPriorityArtifact(thread.id, manuscriptWorkspaceRoot, BIB_PRIORITY, {
      kind: "bibliography",
      label: "References",
    }));
  const notes =
    resolvedPresentedWorkspace?.notes ??
    (await discoverPriorityArtifact(thread.id, manuscriptWorkspaceRoot, NOTES_PRIORITY, {
      kind: "notes",
      label: "Figure notes",
    }));
  const pdf =
    resolvedPresentedWorkspace?.pdf ??
    (await discoverPdfArtifact(thread.id, manuscriptWorkspaceRoot, source));
  const dependencyTime = await newestSourceDependencyTime({
    workspaceRoot: manuscriptWorkspaceRoot,
    source,
    bibliography,
  });
  const parsedLastBuildAttemptAtMs = compileState?.lastBuiltAt
    ? Date.parse(compileState.lastBuiltAt)
    : Number.NaN;
  const lastBuildAttemptAtMs = Number.isFinite(parsedLastBuildAttemptAtMs)
    ? parsedLastBuildAttemptAtMs
    : null;
  const successfulBuildCoversDependencies =
    compileState?.lastError === null &&
    dependencyTime !== null &&
    lastBuildAttemptAtMs !== null &&
    dependencyTime <= lastBuildAttemptAtMs;
  const rawNeedsBuild =
    source?.kind === "latex" &&
    (pdf === null || (dependencyTime !== null && pdf.updatedAtMs < dependencyTime));
  const needsBuild = rawNeedsBuild && !successfulBuildCoversDependencies;
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
    workspaceRoot: manuscriptWorkspaceRoot,
    source,
    pdf,
    bibliography,
    notes,
    preview: previewForState({
      source,
      pdf,
    }),
    compile,
    reviewRecommended: Boolean(source || pdf),
  };
}

function compileEnv(workspaceRoot: string, pathDir: string | undefined): NodeJS.ProcessEnv {
  const cacheRoot = path.join(workspaceRoot, ".cache");
  const configRoot = path.join(workspaceRoot, ".config");
  const tmpRoot = path.join(workspaceRoot, ".tmp");
  const texRoot = path.join(workspaceRoot, ".texlive");

  return {
    ...process.env,
    ...(pathDir ? { PATH: `${pathDir}${path.delimiter}${process.env.PATH ?? ""}` } : {}),
    XDG_CACHE_HOME: cacheRoot,
    XDG_CONFIG_HOME: configRoot,
    TMPDIR: tmpRoot,
    TEMP: tmpRoot,
    TMP: tmpRoot,
    TECTONIC_CACHE_DIR: path.join(cacheRoot, "tectonic"),
    TEXMFVAR: path.join(texRoot, "texmf-var"),
    TEXMFCONFIG: path.join(texRoot, "texmf-config"),
    TEXMFHOME: path.join(texRoot, "texmf-home"),
  };
}

async function runLatexBuild(input: {
  readonly workspaceRoot: string;
  readonly source: PaperReviewArtifact;
  readonly bibliography: PaperReviewArtifact | null;
  readonly compiler: ResolvedCompiler & { kind: Exclude<PaperReviewCompilerKind, "none"> };
}): Promise<{ outputExcerpt: string | null }> {
  const env = compileEnv(input.workspaceRoot, input.compiler.pathDir);

  if (input.compiler.kind === "managed-tectonic") {
    const result = await runProcess(
      input.compiler.command,
      ["-X", "compile", "--keep-intermediates", "--keep-logs", input.source.relativePath],
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

  if (input.compiler.kind === "managed-latexmk" || input.compiler.kind === "system-latexmk") {
    const result = await runProcess(
      input.compiler.command,
      [
        "-pdf",
        "-interaction=nonstopmode",
        "-halt-on-error",
        "-recorder",
        input.source.relativePath,
      ],
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

  const baseArgs = [
    "-interaction=nonstopmode",
    "-halt-on-error",
    "-recorder",
    input.source.relativePath,
  ];
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

  const startCompile = async (input: {
    readonly thread: ResolvedPaperReviewThread;
    readonly snapshot: PaperReviewSnapshot;
    readonly force: boolean;
    readonly awaitBuild: boolean;
  }): Promise<boolean> => {
    const { snapshot, thread } = input;
    if (!thread.workspaceRoot || !snapshot.workspaceRoot) {
      return false;
    }
    if (!snapshot.source || snapshot.source.kind !== "latex") {
      return false;
    }
    if (!snapshot.compile.canCompile || snapshot.compile.compiler === "none") {
      return false;
    }
    if (!input.force && snapshot.compile.status !== "idle") {
      return false;
    }
    if (!input.force && !snapshot.compile.needsBuild) {
      return false;
    }

    const compiler = resolveCompiler();
    if (compiler.kind === "none") {
      return false;
    }

    const state = nextCompileState(compileSessions.get(thread.id));
    if (state.inFlightBuild) {
      if (input.awaitBuild) {
        await state.inFlightBuild;
      }
      return true;
    }

    state.status = "compiling";
    state.lastError = null;
    state.outputExcerpt = null;

    const buildPromise = runLatexBuild({
      workspaceRoot: snapshot.workspaceRoot,
      source: snapshot.source,
      bibliography: snapshot.bibliography,
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
          `${state.outputExcerpt ?? ""}\n${error instanceof Error ? (error.stack ?? error.message) : String(error)}`,
        );
      })
      .finally(() => {
        state.inFlightBuild = null;
      });

    state.inFlightBuild = buildPromise;
    compileSessions.set(thread.id, state);

    if (input.awaitBuild) {
      await buildPromise;
    }

    return true;
  };

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

    const snapshot = await inspectThreadWorkspace(thread, compileSessions.get(threadId) ?? null);
    const startedCompile = await startCompile({
      thread,
      snapshot,
      force: false,
      awaitBuild: false,
    });

    if (!startedCompile || snapshot.compile.status !== "idle") {
      return snapshot;
    }

    return {
      ...snapshot,
      compile: {
        ...snapshot.compile,
        status: "compiling",
        lastError: null,
      },
    };
  };

  const getSnapshot: PaperReviewServiceShape["getSnapshot"] = (threadId) =>
    Effect.tryPromise(() => inspect(threadId));

  const compile: PaperReviewServiceShape["compile"] = (threadId) =>
    Effect.tryPromise(async () => {
      const thread = await resolveThread(orchestrationEngine, threadId);
      if (!thread || !thread.workspaceRoot) {
        return inspect(threadId);
      }

      const initialSnapshot = await inspectThreadWorkspace(
        thread,
        compileSessions.get(threadId) ?? null,
      );
      const startedCompile = await startCompile({
        thread,
        snapshot: initialSnapshot,
        force: true,
        awaitBuild: true,
      });
      if (!startedCompile) {
        return initialSnapshot;
      }
      return inspect(threadId);
    });

  const resolveFilePath: PaperReviewServiceShape["resolveFilePath"] = (threadId, relativePath) =>
    Effect.tryPromise(async () => {
      const thread = await resolveThread(orchestrationEngine, threadId);
      if (!thread?.workspaceRoot) {
        return null;
      }
      const presentation = latestPresentedManuscript(thread);
      const presentedWorkspace = presentation
        ? await resolvePresentedWorkspaceArtifacts({
            threadId: thread.id,
            threadWorkspaceRoot: thread.workspaceRoot,
            presentation,
          })
        : null;
      const manuscriptWorkspaceRoot =
        presentedWorkspace?.workspaceRoot ??
        (await resolveManuscriptWorkspaceRoot({
          threadId: thread.id,
          threadWorkspaceRoot: thread.workspaceRoot,
        }));

      const normalized = path.posix.normalize(relativePath.trim().replaceAll("\\", "/"));
      if (
        normalized.length === 0 ||
        normalized === "." ||
        normalized.startsWith("../") ||
        path.isAbsolute(normalized)
      ) {
        return null;
      }

      const absolutePath = path.resolve(manuscriptWorkspaceRoot, normalized);
      const relativeToRoot = path
        .relative(manuscriptWorkspaceRoot, absolutePath)
        .replaceAll("\\", "/");
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
