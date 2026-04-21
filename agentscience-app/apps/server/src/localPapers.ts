/**
 * LocalPapers — filesystem-backed listing of every paper this user has
 * produced with the desktop app.
 *
 * Design notes
 * ------------
 * Papers live on disk at predictable locations under the user's managed
 * workspace root (settings.workspaceRoot, default `~/AgentScience`):
 *
 *   {root}/Papers/{slug}/                                  (unassigned paper)
 *   {root}/Projects/{project-slug}/papers/{slug}/          (project paper)
 *
 * We scan those two places (one level of depth below each container), check
 * every child folder for a `paper.pdf` and/or `paper.tex` (or `paper.md`),
 * pull a title out of the LaTeX/Markdown source when possible, and emit a
 * flat list. Thread linkage is a best-effort match against the orchestration
 * read model by `resolvedWorkspacePath`/`worktreePath` — if the thread has
 * been deleted we still surface the paper (folder-first, not thread-first).
 *
 * Paper IDs are `base64url(absolute folder path)`. This keeps the API
 * stateless (no DB table to sync) and survives app restarts.
 *
 * @module LocalPapers
 */
import Mime from "@effect/platform-node/Mime";
import {
  type LocalPaperContainerKind,
  type LocalPaperFile,
  type LocalPaperPublication,
  type LocalPaperSummary,
  ProjectId,
  ThreadId,
  localPaperFileRoutePath,
} from "@agentscience/contracts";
import { Effect, Layer, ServiceMap } from "effect";
import fs from "node:fs/promises";
import path from "node:path";

import { AgentScienceAuthService } from "./agentScienceAuth.ts";
import { ServerConfig } from "./config.ts";
import { OrchestrationEngineService } from "./orchestration/Services/OrchestrationEngine.ts";
import { ServerSettingsService } from "./serverSettings.ts";
import {
  PAPERS_DIRNAME,
  PROJECT_PAPERS_DIRNAME,
  PROJECTS_DIRNAME,
  normalizeWorkspacePath,
} from "./workspace/roots.ts";

/**
 * Candidate filenames that we accept as "the paper". We search for the
 * first match in preference order, and we search recursively — agents and
 * LaTeX build tooling commonly nest the compiled PDF under `manuscript/`,
 * `workspace/`, or similar, so a flat scan misses real papers.
 */
const PDF_FILENAME_CANDIDATES = [
  "paper.pdf",
  "manuscript.pdf",
  "main.pdf",
] as const;
const TEX_FILENAME_CANDIDATES = [
  "paper.tex",
  "manuscript.tex",
  "main.tex",
] as const;
const MD_FILENAME_CANDIDATES = [
  "paper.md",
  "manuscript.md",
] as const;

/** Directories we never recurse into while searching for paper artifacts. */
const SCAN_SKIP_DIRS = new Set<string>([
  "node_modules",
  ".git",
  ".venv",
  "venv",
  ".mpl",
  ".mplconfig",
  ".pytest_cache",
  "__pycache__",
  ".cache",
  "dist",
  "build",
  "out",
  ".next",
  ".turbo",
  ".parcel-cache",
]);

/**
 * How deep we will look under a chat folder before giving up. Generous
 * enough to catch `manuscript/`, `workspace/output/`, etc., but bounded so
 * we don't walk arbitrary project trees.
 */
const MAX_SCAN_DEPTH = 4;

const PUBLISH_MANIFEST_FILENAME = "agentscience.publish.json";
const PUBLISHED_METADATA_FILENAME = ".agentscience-published.json";
const BIB_FILENAME_CANDIDATES = [
  "references.bib",
  "paper.bib",
  "manuscript.bib",
  "main.bib",
] as const;
const BUNDLE_SKIP_SUFFIXES = [
  ".aux",
  ".fdb_latexmk",
  ".fls",
  ".log",
  ".out",
  ".pyc",
  ".synctex.gz",
  ".toc",
] as const;
const FIGURE_EXTENSIONS = new Set([".gif", ".jpeg", ".jpg", ".png", ".svg", ".webp"]);
/**
 * Max bytes read from a source file while extracting title + abstract.
 * Big enough to get past a typical LaTeX preamble + abstract body; small
 * enough that scanning dozens of papers stays snappy.
 */
const SOURCE_EXTRACT_MAX_BYTES = 64 * 1024;

export interface LocalPapersServiceShape {
  /** Scan the managed workspace and return every paper found on disk. */
  readonly list: () => Effect.Effect<LocalPaperSummary[]>;
  /**
   * Resolve a file inside a paper folder to an absolute filesystem path, or
   * `null` if the path is outside the paper's folder or does not exist.
   * Used by the HTTP layer to serve previews and downloads.
   */
  readonly resolveFilePath: (
    paperId: string,
    relativePath: string,
  ) => Effect.Effect<string | null>;
  /** Publish or update a local paper on AgentScience. */
  readonly publish: (
    paperId: string,
  ) => Effect.Effect<LocalPaperSummary, LocalPaperPublishError>;
}

export class LocalPapersService extends ServiceMap.Service<
  LocalPapersService,
  LocalPapersServiceShape
>()("agentscience/LocalPapersService") {}

export class LocalPaperPublishError extends Error {
  readonly status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "LocalPaperPublishError";
    this.status = status;
  }
}

type StoredPublicationRecord = {
  readonly ownerUserId: string;
  readonly publication: LocalPaperPublication;
};

type UploadDescriptor = {
  readonly fileName: string;
  readonly contentType: string;
  readonly bytes: Buffer;
};

type ArtifactUploadDescriptor = {
  readonly path: string;
  readonly contentType: string;
  readonly bytes: Buffer;
};

// ── ID helpers ──────────────────────────────────────────────────────────

function encodePaperId(absolutePath: string): string {
  return Buffer.from(absolutePath, "utf8").toString("base64url");
}

function decodePaperId(paperId: string): string | null {
  try {
    const decoded = Buffer.from(paperId, "base64url").toString("utf8");
    if (!decoded || !path.isAbsolute(decoded)) {
      return null;
    }
    return path.resolve(decoded);
  } catch {
    return null;
  }
}

function joinUrl(base: string, pathname: string): string {
  return new URL(pathname, `${base.replace(/\/+$/, "")}/`).toString();
}

// ── Filesystem helpers ──────────────────────────────────────────────────

async function listDirectories(root: string): Promise<string[]> {
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .map((entry) => path.join(root, entry.name));
}

interface StatInfo {
  readonly sizeBytes: number;
  readonly updatedAt: string;
}

async function statFileIfPresent(filePath: string): Promise<StatInfo | null> {
  try {
    const stat = await fs.stat(filePath);
    if (!stat.isFile()) return null;
    return {
      sizeBytes: stat.size,
      updatedAt: new Date(stat.mtimeMs).toISOString(),
    };
  } catch {
    return null;
  }
}

async function readFirstBytes(filePath: string, maxBytes: number): Promise<string | null> {
  try {
    const handle = await fs.open(filePath, "r");
    try {
      const buffer = Buffer.alloc(maxBytes);
      const { bytesRead } = await handle.read(buffer, 0, maxBytes, 0);
      return buffer.subarray(0, bytesRead).toString("utf8");
    } finally {
      await handle.close();
    }
  } catch {
    return null;
  }
}

async function readFileText(filePath: string): Promise<string> {
  return fs.readFile(filePath, "utf8");
}

async function readFileBuffer(filePath: string): Promise<Buffer> {
  return fs.readFile(filePath);
}

function resolvePaperFolderAbsolutePath(
  paperId: string,
  containerRoot: string,
): string | null {
  const folderAbsolutePath = decodePaperId(paperId);
  if (!folderAbsolutePath) {
    return null;
  }

  const relativeToRoot = path.relative(containerRoot, folderAbsolutePath);
  if (
    relativeToRoot.length === 0 ||
    relativeToRoot.startsWith("..") ||
    path.isAbsolute(relativeToRoot)
  ) {
    return null;
  }

  return folderAbsolutePath;
}

function toPaperCandidate(
  folderAbsolutePath: string,
  containerRoot: string,
): PaperCandidate | null {
  const relative = path.relative(containerRoot, folderAbsolutePath).replaceAll("\\", "/");
  if (
    relative.length === 0 ||
    relative.startsWith("../") ||
    path.isAbsolute(relative)
  ) {
    return null;
  }

  const segments = relative.split("/").filter((segment) => segment.length > 0);
  if (segments.length === 2 && segments[0] === PAPERS_DIRNAME) {
    return {
      folderAbsolutePath,
      folderName: segments[1]!,
      containerKind: "paper",
      projectFolderAbsolutePath: null,
      projectFolderSlug: null,
    };
  }

  if (
    segments.length === 4 &&
    segments[0] === PROJECTS_DIRNAME &&
    segments[2] === PROJECT_PAPERS_DIRNAME
  ) {
    return {
      folderAbsolutePath,
      folderName: segments[3]!,
      containerKind: "project-paper",
      projectFolderAbsolutePath: path.join(containerRoot, segments[0]!, segments[1]!),
      projectFolderSlug: segments[1]!,
    };
  }

  return null;
}

function normalizePublicationRecord(value: unknown): StoredPublicationRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const ownerUserId =
    typeof record.ownerUserId === "string" && record.ownerUserId.trim().length > 0
      ? record.ownerUserId.trim()
      : null;
  const remotePaperId =
    typeof record.remotePaperId === "string" && record.remotePaperId.trim().length > 0
      ? record.remotePaperId.trim()
      : null;
  const slug =
    typeof record.slug === "string" && record.slug.trim().length > 0
      ? record.slug.trim()
      : null;
  const url =
    typeof record.url === "string" && record.url.trim().length > 0
      ? record.url.trim()
      : null;
  const publishedAt =
    typeof record.publishedAt === "string" && Number.isFinite(Date.parse(record.publishedAt))
      ? new Date(record.publishedAt).toISOString()
      : null;

  if (!ownerUserId || !remotePaperId || !slug || !url || !publishedAt) {
    return null;
  }

  return {
    ownerUserId,
    publication: {
      remotePaperId,
      slug,
      url,
      publishedAt,
    },
  };
}

async function readPublicationRecord(
  folderAbsolutePath: string,
): Promise<StoredPublicationRecord | null> {
  const metadataPath = path.join(folderAbsolutePath, PUBLISHED_METADATA_FILENAME);
  const raw = await readFirstBytes(metadataPath, SOURCE_EXTRACT_MAX_BYTES);
  if (!raw) {
    return null;
  }

  try {
    return normalizePublicationRecord(JSON.parse(raw));
  } catch {
    return null;
  }
}

async function writePublicationRecord(
  folderAbsolutePath: string,
  input: StoredPublicationRecord,
): Promise<void> {
  const metadataPath = path.join(folderAbsolutePath, PUBLISHED_METADATA_FILENAME);
  await fs.writeFile(
    metadataPath,
    `${JSON.stringify(
      {
        version: 1,
        ownerUserId: input.ownerUserId,
        remotePaperId: input.publication.remotePaperId,
        slug: input.publication.slug,
        url: input.publication.url,
        publishedAt: input.publication.publishedAt,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
}

function shouldSkipBundlePath(relativePath: string): boolean {
  if (!relativePath || relativePath.startsWith("../")) {
    return true;
  }

  if (relativePath === PUBLISHED_METADATA_FILENAME) {
    return true;
  }

  if (
    relativePath
      .split("/")
      .some((segment) => segment.startsWith(".") || SCAN_SKIP_DIRS.has(segment))
  ) {
    return true;
  }

  return BUNDLE_SKIP_SUFFIXES.some((suffix) => relativePath.endsWith(suffix));
}

function guessBundleContentType(relativePath: string): string {
  return Mime.getType(relativePath) ?? "application/octet-stream";
}

function isFigureFile(relativePath: string): boolean {
  return FIGURE_EXTENSIONS.has(path.extname(relativePath).toLowerCase());
}

async function walkPublishBundle(
  currentDir: string,
  workspaceDir: string,
  artifacts: ArtifactUploadDescriptor[],
  figures: UploadDescriptor[],
): Promise<void> {
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(currentDir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const absolutePath = path.join(currentDir, entry.name);
    const relativePath = path.relative(workspaceDir, absolutePath).replaceAll("\\", "/");

    if (shouldSkipBundlePath(relativePath)) {
      continue;
    }

    if (entry.isDirectory()) {
      await walkPublishBundle(absolutePath, workspaceDir, artifacts, figures);
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    const contentType = guessBundleContentType(relativePath);
    if (contentType === "application/octet-stream") {
      continue;
    }

    const bytes = await readFileBuffer(absolutePath);
    if (isFigureFile(relativePath)) {
      figures.push({
        fileName: path.basename(absolutePath),
        contentType,
        bytes,
      });
      continue;
    }

    artifacts.push({
      path: relativePath,
      contentType,
      bytes,
    });
  }
}

async function collectPublishBundle(folderAbsolutePath: string): Promise<{
  readonly artifacts: ArtifactUploadDescriptor[];
  readonly figures: UploadDescriptor[];
}> {
  const artifacts: ArtifactUploadDescriptor[] = [];
  const figures: UploadDescriptor[] = [];
  await walkPublishBundle(folderAbsolutePath, folderAbsolutePath, artifacts, figures);
  return { artifacts, figures };
}

function assertPublishablePaper(summary: LocalPaperSummary): asserts summary is LocalPaperSummary & {
  pdf: LocalPaperFile;
  source: LocalPaperFile;
} {
  if (!summary.source) {
    throw new LocalPaperPublishError("This paper is missing a source file.", 400);
  }
  if (!summary.pdf) {
    throw new LocalPaperPublishError("This paper is missing a compiled PDF.", 400);
  }
  if (!summary.source.relativePath.endsWith(".tex")) {
    throw new LocalPaperPublishError(
      "This paper needs a LaTeX source file before it can be published.",
      400,
    );
  }
  if (summary.title.trim().length < 12) {
    throw new LocalPaperPublishError(
      "This paper title is too short to publish. Use at least 12 characters.",
      400,
    );
  }
  if (!summary.abstract || summary.abstract.trim().length < 80) {
    throw new LocalPaperPublishError(
      "This paper needs an abstract of at least 80 characters before publishing.",
      400,
    );
  }
}

async function buildPublishFormData(input: {
  readonly folderAbsolutePath: string;
  readonly summary: LocalPaperSummary;
}): Promise<FormData> {
  assertPublishablePaper(input.summary);
  const abstract = input.summary.abstract?.trim();
  if (!abstract) {
    throw new LocalPaperPublishError(
      "This paper needs an abstract of at least 80 characters before publishing.",
      400,
    );
  }

  const sourceAbsolutePath = path.join(
    input.folderAbsolutePath,
    input.summary.source.relativePath,
  );
  const pdfAbsolutePath = path.join(input.folderAbsolutePath, input.summary.pdf.relativePath);
  const [latexSource, pdfBytes, bibMatch, bundle] = await Promise.all([
    readFileText(sourceAbsolutePath),
    readFileBuffer(pdfAbsolutePath),
    findShallowestCandidate(
      input.folderAbsolutePath,
      BIB_FILENAME_CANDIDATES,
      MAX_SCAN_DEPTH,
    ),
    collectPublishBundle(input.folderAbsolutePath),
  ]);

  const form = new FormData();
  form.set("title", input.summary.title.trim());
  form.set("abstract", abstract);
  form.set("latexSource", latexSource);
  form.set(
    "pdf",
    new File([pdfBytes], path.basename(pdfAbsolutePath), {
      type: guessBundleContentType(input.summary.pdf.relativePath) || "application/pdf",
    }),
  );

  if (bibMatch) {
    const bibSource = await readFileText(
      path.join(input.folderAbsolutePath, bibMatch.relativePath),
    ).catch(() => null);
    if (bibSource && bibSource.trim().length > 0) {
      form.set("bibSource", bibSource);
    }
  }

  if (bundle.artifacts.length > 0) {
    form.set(
      "artifactManifest",
      JSON.stringify(
        bundle.artifacts.map((artifact, index) => ({
          fieldName: `artifact_${index}`,
          path: artifact.path,
          contentType: artifact.contentType,
        })),
      ),
    );
    bundle.artifacts.forEach((artifact, index) => {
      form.set(
        `artifact_${index}`,
        new File([artifact.bytes], path.basename(artifact.path), {
          type: artifact.contentType,
        }),
      );
    });
  }

  for (const figure of bundle.figures) {
    form.append(
      "figures",
      new File([figure.bytes], figure.fileName, {
        type: figure.contentType,
      }),
    );
  }

  return form;
}

function parsePublishedPaperResponse(
  payload: unknown,
  baseUrl: string,
): LocalPaperPublication | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }

  const record = payload as Record<string, unknown>;
  if (!record.paper || typeof record.paper !== "object" || Array.isArray(record.paper)) {
    return null;
  }

  const paper = record.paper as Record<string, unknown>;
  const remotePaperId =
    typeof paper.id === "string" && paper.id.trim().length > 0 ? paper.id.trim() : null;
  const slug =
    typeof paper.slug === "string" && paper.slug.trim().length > 0 ? paper.slug.trim() : null;
  const publishedAt =
    typeof paper.publishedAt === "string" && Number.isFinite(Date.parse(paper.publishedAt))
      ? new Date(paper.publishedAt).toISOString()
      : null;

  if (!remotePaperId || !slug || !publishedAt) {
    return null;
  }

  return {
    remotePaperId,
    slug,
    url: joinUrl(baseUrl, `/papers/${encodeURIComponent(slug)}`),
    publishedAt,
  };
}

/**
 * Recursively search `root` for the shallowest file whose basename appears
 * in `candidateNames` (preference order breaks ties at the same depth).
 *
 * Returns the path relative to `root` plus the file stat, or `null` if no
 * candidate is found before hitting `maxDepth` or running out of
 * directories. Hidden dirs and `SCAN_SKIP_DIRS` are pruned.
 */
async function findShallowestCandidate(
  root: string,
  candidateNames: readonly string[],
  maxDepth: number,
): Promise<{ relativePath: string; stat: StatInfo } | null> {
  // BFS level-by-level; at each level we prefer earlier names in
  // `candidateNames` over later ones. This naturally picks
  // `paper.pdf` over `manuscript.pdf` when both exist at the same depth.
  let currentLevel: string[] = [root];
  let depth = 0;

  while (currentLevel.length > 0 && depth <= maxDepth) {
    const nextLevel: string[] = [];
    // Fixed-preference search per directory at this depth.
    const matchesAtThisLevel: Array<{
      relativePath: string;
      stat: StatInfo;
      priority: number;
    }> = [];

    for (const dir of currentLevel) {
      let entries: import("node:fs").Dirent[];
      try {
        entries = await fs.readdir(dir, { withFileTypes: true });
      } catch {
        continue;
      }

      for (const entry of entries) {
        if (entry.isDirectory()) {
          if (entry.name.startsWith(".") || SCAN_SKIP_DIRS.has(entry.name)) {
            continue;
          }
          nextLevel.push(path.join(dir, entry.name));
          continue;
        }
        if (!entry.isFile()) continue;
        const priority = candidateNames.indexOf(entry.name);
        if (priority === -1) continue;
        const absolute = path.join(dir, entry.name);
        const stat = await statFileIfPresent(absolute);
        if (!stat) continue;
        matchesAtThisLevel.push({
          relativePath: path.relative(root, absolute).replaceAll("\\", "/"),
          stat,
          priority,
        });
      }
    }

    if (matchesAtThisLevel.length > 0) {
      matchesAtThisLevel.sort((a, b) => a.priority - b.priority);
      const best = matchesAtThisLevel[0]!;
      return { relativePath: best.relativePath, stat: best.stat };
    }

    currentLevel = nextLevel;
    depth += 1;
  }

  return null;
}

// ── LaTeX text extraction ───────────────────────────────────────────────

/**
 * Strip LaTeX line comments from a source snippet.
 *
 * In LaTeX, `%` starts a comment that runs to the end of the line AND
 * swallows the following newline's leading whitespace — authors use this
 * to break long arguments across lines without introducing a space.
 * Our paper template does:
 *
 *     \title{%
 *       From Acceleration to Reset: ...
 *     }
 *
 * so without comment-stripping we'd read `% From Acceleration to Reset...`
 * verbatim, which is garbage. Escaped `\%` is preserved.
 */
function stripLatexComments(input: string): string {
  let out = "";
  let i = 0;
  while (i < input.length) {
    const ch = input[i]!;
    if (ch === "\\" && i + 1 < input.length) {
      out += ch + input[i + 1];
      i += 2;
      continue;
    }
    if (ch === "%") {
      // Skip to end of line AND the following newline (LaTeX comment
      // absorbs the line terminator).
      while (i < input.length && input[i] !== "\n") i += 1;
      if (input[i] === "\n") i += 1;
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

/**
 * Read the contents of a LaTeX brace group starting at `start` (which must
 * point at `{`), returning the inner text and the index after the matching
 * `}`. Respects one-level escape (`\{` / `\}`) so authors can embed literal
 * braces in a title/abstract.
 */
function readBalancedBraceGroup(
  source: string,
  start: number,
): { value: string; end: number } | null {
  if (source[start] !== "{") return null;
  let depth = 1;
  let cursor = start + 1;
  let value = "";
  while (cursor < source.length && depth > 0) {
    const ch = source[cursor]!;
    if (ch === "\\" && cursor + 1 < source.length) {
      value += ch + source[cursor + 1];
      cursor += 2;
      continue;
    }
    if (ch === "{") {
      depth += 1;
      value += ch;
    } else if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        cursor += 1;
        return { value, end: cursor };
      }
      value += ch;
    } else {
      value += ch;
    }
    cursor += 1;
  }
  return null;
}

function extractLatexTitle(source: string): string | null {
  // Strip comments first so `\title{%\n  ...\n}` extracts the body.
  const cleaned = stripLatexComments(source);
  // Match `\title` only when followed by a non-letter — otherwise the
  // preamble's `\titleformat{...}` (from the AgentScience template) wins.
  const titleRegex = /\\title(?![a-zA-Z])\s*\{/g;
  const match = titleRegex.exec(cleaned);
  if (!match) return null;
  const braceStart = match.index + match[0].length - 1;
  const group = readBalancedBraceGroup(cleaned, braceStart);
  if (!group) return null;
  const text = cleanTitleWhitespace(stripBasicLatex(group.value));
  return text.length > 0 ? text : null;
}

/**
 * Commands whose argument is a filename / reference, not prose. Their
 * contents must be DROPPED, not unwrapped, when flattening LaTeX to text.
 */
const LATEX_DROP_COMMANDS = new Set([
  "input",
  "include",
  "bibliography",
  "bibliographystyle",
  "label",
  "ref",
  "cite",
  "citep",
  "citet",
  "pageref",
]);

function stripBasicLatex(input: string): string {
  return input
    .replace(/\\textbf\s*\{([^{}]*)\}/g, "$1")
    .replace(/\\textit\s*\{([^{}]*)\}/g, "$1")
    .replace(/\\emph\s*\{([^{}]*)\}/g, "$1")
    .replace(/\\([a-zA-Z]+)\s*\{([^{}]*)\}/g, (_m, name, body) =>
      LATEX_DROP_COMMANDS.has(name) ? "" : body,
    )
    .replace(/\\[a-zA-Z]+/g, "")
    .replace(/\{([^{}]*)\}/g, "$1")
    .replace(/~/g, " ")
    .replace(/\\\\/g, " ")
    // LaTeX escape sequences for common text characters. Keep after the
    // command-stripping passes above so we don't accidentally collapse them.
    .replace(/\\([%$&#_{}])/g, "$1");
}

/**
 * Parse the raw abstract body out of LaTeX source. Returns a RAW string
 * that may still contain `\input{...}` references — those are resolved by
 * the caller, which has filesystem access.
 */
function parseLatexAbstractRaw(source: string): string | null {
  const cleaned = stripLatexComments(source);

  // 1) \begin{abstract} ... \end{abstract}
  const beginMarker = cleaned.indexOf("\\begin{abstract}");
  if (beginMarker !== -1) {
    const bodyStart = beginMarker + "\\begin{abstract}".length;
    const endMarker = cleaned.indexOf("\\end{abstract}", bodyStart);
    if (endMarker !== -1) {
      return cleaned.slice(bodyStart, endMarker);
    }
  }

  // 2) \renewcommand{\paperabstract}{ ... } (AgentScience template)
  // Also handles \newcommand{\paperabstract}{ ... } and minor whitespace.
  const renewRegex = /\\(?:renew|new)command\s*\{\s*\\paperabstract\s*\}\s*/g;
  let match: RegExpExecArray | null;
  let bestCandidate: string | null = null;
  while ((match = renewRegex.exec(cleaned)) !== null) {
    const afterHeader = match.index + match[0].length;
    const group = readBalancedBraceGroup(cleaned, afterHeader);
    if (!group) continue;
    // Skip empty placeholder `\newcommand{\paperabstract}{}` declarations;
    // the real body comes via a later `\renewcommand`.
    if (group.value.trim().length > 0) {
      bestCandidate = group.value;
    }
  }
  return bestCandidate;
}

/**
 * Finalize a raw LaTeX abstract body into display text. Shared between
 * the pure synchronous extractor (used in unit tests) and the async one
 * that also resolves `\input{...}` files.
 */
function finalizeAbstract(raw: string): string | null {
  const text = cleanAbstractWhitespace(stripBasicLatex(raw));
  return text.length > 0 ? text : null;
}

/**
 * Synchronous abstract extractor. Does not resolve `\input{...}`; if the
 * body is a bare include the caller should use `extractLatexAbstractAsync`.
 */
function extractLatexAbstract(source: string): string | null {
  const raw = parseLatexAbstractRaw(source);
  if (raw === null) return null;
  return finalizeAbstract(raw);
}

/**
 * Async extractor that additionally resolves a single `\input{foo}` or
 * `\input{foo.tex}` inside the abstract body by reading the referenced
 * file relative to `sourceDirAbsolutePath`. Handles the common template
 * pattern `\begin{abstract}\n\\input{abstract.txt}\n\end{abstract}`.
 */
async function extractLatexAbstractAsync(
  source: string,
  sourceDirAbsolutePath: string,
): Promise<string | null> {
  const raw = parseLatexAbstractRaw(source);
  if (raw === null) return null;

  const inputMatch = raw.match(/\\input\s*\{([^{}]+)\}/);
  if (inputMatch) {
    const rawTarget = inputMatch[1]!.trim();
    // Accept both `abstract` and `abstract.txt` / `.tex`.
    const candidates = /\.[a-zA-Z0-9]+$/.test(rawTarget)
      ? [rawTarget]
      : [`${rawTarget}.tex`, `${rawTarget}.txt`, rawTarget];
    for (const candidate of candidates) {
      // Guard against paths escaping the paper folder.
      const normalized = path.normalize(candidate);
      if (normalized.startsWith("..") || path.isAbsolute(normalized)) continue;
      const absolutePath = path.join(sourceDirAbsolutePath, normalized);
      const content = await readFirstBytes(absolutePath, SOURCE_EXTRACT_MAX_BYTES);
      if (content && content.trim().length > 0) {
        // If the included file is a plain .txt, don't run LaTeX stripping
        // on it in a way that mangles escaped characters — finalize still
        // collapses whitespace and handles `\%`, `\$`, etc.
        return finalizeAbstract(content);
      }
    }
  }

  return finalizeAbstract(raw);
}

function extractMarkdownTitle(source: string): string | null {
  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.startsWith("# ")) {
      return cleanTitleWhitespace(line.slice(2));
    }
    if (line.length > 0 && !line.startsWith("%") && !line.startsWith("<")) {
      break;
    }
  }
  return null;
}

/**
 * Extract an abstract from Markdown source: the paragraph following a
 * `## Abstract` (or `# Abstract`) heading, up to the next heading. Falls
 * back to the first non-trivial paragraph when no Abstract heading exists.
 */
function extractMarkdownAbstract(source: string): string | null {
  const lines = source.split(/\r?\n/);

  // 1) Find an "## Abstract" / "# Abstract" / "### Abstract" heading.
  const headingIdx = lines.findIndex((line) =>
    /^#{1,6}\s+abstract\s*$/i.test(line.trim()),
  );
  if (headingIdx !== -1) {
    const collected: string[] = [];
    for (let i = headingIdx + 1; i < lines.length; i += 1) {
      const line = lines[i]!;
      if (/^#{1,6}\s+/.test(line.trim())) break;
      collected.push(line);
    }
    const text = cleanAbstractWhitespace(collected.join(" "));
    if (text.length > 0) return text;
  }

  return null;
}

function cleanTitleWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

/**
 * Preserve sentence structure while collapsing runs of whitespace. Keeps
 * the output as a single line so list rows line-clamp cleanly.
 */
function cleanAbstractWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function folderNameToTitle(folderName: string): string {
  const cleaned = folderName
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return "Untitled paper";
  return cleaned.slice(0, 1).toUpperCase() + cleaned.slice(1);
}

interface ResolvedPaperMetadata {
  readonly title: string;
  readonly abstract: string | null;
}

/**
 * Extract the best available title + abstract for a paper. Source is read
 * once (if available) and both extractors run against the same buffer.
 * The title falls back through: source → thread title → folder name.
 * The abstract is null when no source exists or the source has none.
 */
async function resolvePaperMetadata(input: {
  readonly folderPath: string;
  readonly sourceRelativePath: string | null;
  readonly folderName: string;
  readonly fallbackTitle: string | null;
}): Promise<ResolvedPaperMetadata> {
  let extractedTitle: string | null = null;
  let extractedAbstract: string | null = null;

  if (input.sourceRelativePath) {
    const sourceAbsolutePath = path.join(input.folderPath, input.sourceRelativePath);
    const source = await readFirstBytes(sourceAbsolutePath, SOURCE_EXTRACT_MAX_BYTES);
    if (source && source.trim().length > 0) {
      const isLatex = input.sourceRelativePath.endsWith(".tex");
      extractedTitle = isLatex ? extractLatexTitle(source) : extractMarkdownTitle(source);
      if (isLatex) {
        // Async variant resolves `\input{abstract.txt}` from the paper folder.
        extractedAbstract = await extractLatexAbstractAsync(
          source,
          path.dirname(sourceAbsolutePath),
        );
      } else {
        extractedAbstract = extractMarkdownAbstract(source);
      }
    }
  }

  let title: string;
  if (extractedTitle && extractedTitle.length > 0) {
    title = extractedTitle;
  } else if (input.fallbackTitle && input.fallbackTitle.trim().length > 0) {
    title = cleanTitleWhitespace(input.fallbackTitle);
  } else {
    title = folderNameToTitle(input.folderName);
  }

  return { title, abstract: extractedAbstract };
}

// ── Candidate folder discovery ──────────────────────────────────────────

interface PaperCandidate {
  readonly folderAbsolutePath: string;
  readonly folderName: string;
  readonly containerKind: LocalPaperContainerKind;
  readonly projectFolderAbsolutePath: string | null;
  readonly projectFolderSlug: string | null;
}

async function discoverCandidateFolders(containerRoot: string): Promise<PaperCandidate[]> {
  const results: PaperCandidate[] = [];

  // {root}/Papers/{slug}/
  const unassignedRoot = path.join(containerRoot, PAPERS_DIRNAME);
  for (const folderPath of await listDirectories(unassignedRoot)) {
    results.push({
      folderAbsolutePath: folderPath,
      folderName: path.basename(folderPath),
      containerKind: "paper",
      projectFolderAbsolutePath: null,
      projectFolderSlug: null,
    });
  }

  // {root}/Projects/{project}/papers/{slug}/
  const projectsRoot = path.join(containerRoot, PROJECTS_DIRNAME);
  for (const projectFolder of await listDirectories(projectsRoot)) {
    const projectPapersRoot = path.join(projectFolder, PROJECT_PAPERS_DIRNAME);
    for (const folderPath of await listDirectories(projectPapersRoot)) {
      results.push({
        folderAbsolutePath: folderPath,
        folderName: path.basename(folderPath),
        containerKind: "project-paper",
        projectFolderAbsolutePath: projectFolder,
        projectFolderSlug: path.basename(projectFolder),
      });
    }
  }

  return results;
}

// ── Thread/project lookup ───────────────────────────────────────────────

interface ThreadLookupEntry {
  readonly threadId: string;
  readonly threadTitle: string;
  readonly archivedAt: string | null;
}

interface ProjectLookupEntry {
  readonly projectId: string;
  readonly projectName: string;
}

interface ReadModelLookups {
  readonly threadsByPath: Map<string, ThreadLookupEntry>;
  readonly threadsBySlug: Map<string, ThreadLookupEntry>;
  readonly projectsByPath: Map<string, ProjectLookupEntry>;
  readonly projectsBySlug: Map<string, ProjectLookupEntry>;
}

function normalizePathKey(absolutePath: string): string {
  return path.resolve(absolutePath);
}

function buildReadModelLookups(readModel: {
  readonly threads: ReadonlyArray<{
    readonly id: string;
    readonly title: string;
    readonly archivedAt: string | null;
    readonly resolvedWorkspacePath: string | null;
    readonly worktreePath: string | null;
    readonly folderSlug: string;
  }>;
  readonly projects: ReadonlyArray<{
    readonly id: string;
    readonly title: string;
    readonly folderSlug: string;
  }>;
}): ReadModelLookups {
  const threadsByPath = new Map<string, ThreadLookupEntry>();
  const threadsBySlug = new Map<string, ThreadLookupEntry>();
  for (const thread of readModel.threads) {
    const entry: ThreadLookupEntry = {
      threadId: thread.id,
      threadTitle: thread.title,
      archivedAt: thread.archivedAt ?? null,
    };
    const candidatePaths = [thread.resolvedWorkspacePath, thread.worktreePath];
    for (const candidate of candidatePaths) {
      if (candidate) {
        threadsByPath.set(normalizePathKey(candidate), entry);
      }
    }
    if (thread.folderSlug && !threadsBySlug.has(thread.folderSlug)) {
      threadsBySlug.set(thread.folderSlug, entry);
    }
  }

  // OrchestrationProject carries `title` (not `name`) and does not expose a
  // resolved workspace path. We match project-paper folders to projects via
  // the `folderSlug`, which is guaranteed to be the directory name under
  // `Projects/`.
  const projectsByPath = new Map<string, ProjectLookupEntry>();
  const projectsBySlug = new Map<string, ProjectLookupEntry>();
  for (const project of readModel.projects) {
    const entry: ProjectLookupEntry = {
      projectId: project.id,
      projectName: project.title,
    };
    if (project.folderSlug) {
      projectsBySlug.set(project.folderSlug, entry);
    }
  }

  return { threadsByPath, threadsBySlug, projectsByPath, projectsBySlug };
}

// ── Paper summary assembly ──────────────────────────────────────────────

async function inspectPaperFolder(
  candidate: PaperCandidate,
  lookups: ReadModelLookups,
): Promise<LocalPaperSummary | null> {
  // Recursively search for the paper artifacts. Agents don't reliably drop
  // the PDF/TeX at the folder root — they often nest it in `manuscript/`,
  // `workspace/`, `output/`, etc.
  const pdfMatch = await findShallowestCandidate(
    candidate.folderAbsolutePath,
    PDF_FILENAME_CANDIDATES,
    MAX_SCAN_DEPTH,
  );
  const texMatch = await findShallowestCandidate(
    candidate.folderAbsolutePath,
    TEX_FILENAME_CANDIDATES,
    MAX_SCAN_DEPTH,
  );
  const mdMatch = texMatch
    ? null
    : await findShallowestCandidate(
        candidate.folderAbsolutePath,
        MD_FILENAME_CANDIDATES,
        MAX_SCAN_DEPTH,
      );

  const sourceMatch = texMatch ?? mdMatch;

  // Skip folders that don't contain either a compiled PDF or a source file —
  // we only want things that are actually papers, not empty scaffolding.
  if (!pdfMatch && !sourceMatch) {
    return null;
  }

  const publishManifestPresent =
    (await statFileIfPresent(
      path.join(candidate.folderAbsolutePath, PUBLISH_MANIFEST_FILENAME),
    )) !== null;
  const publicationRecord = await readPublicationRecord(candidate.folderAbsolutePath);

  const thread =
    lookups.threadsByPath.get(normalizePathKey(candidate.folderAbsolutePath)) ??
    lookups.threadsBySlug.get(candidate.folderName) ??
    null;

  const project = candidate.projectFolderAbsolutePath
    ? (lookups.projectsByPath.get(normalizePathKey(candidate.projectFolderAbsolutePath)) ??
      (candidate.projectFolderSlug
        ? (lookups.projectsBySlug.get(candidate.projectFolderSlug) ?? null)
        : null))
    : null;

  const { title, abstract } = await resolvePaperMetadata({
    folderPath: candidate.folderAbsolutePath,
    sourceRelativePath: sourceMatch?.relativePath ?? null,
    folderName: candidate.folderName,
    fallbackTitle: thread?.threadTitle ?? null,
  });

  const id = encodePaperId(candidate.folderAbsolutePath);

  const toFile = (
    relativePath: string,
    stat: StatInfo,
  ): LocalPaperFile => ({
    relativePath,
    url: localPaperFileRoutePath(id, relativePath),
    sizeBytes: stat.sizeBytes,
    updatedAt: stat.updatedAt,
    contentType: Mime.getType(relativePath) ?? "application/octet-stream",
  });

  const latestTimestamp = Math.max(
    pdfMatch ? Date.parse(pdfMatch.stat.updatedAt) : 0,
    sourceMatch ? Date.parse(sourceMatch.stat.updatedAt) : 0,
  );
  const updatedAt = new Date(
    Number.isFinite(latestTimestamp) && latestTimestamp > 0 ? latestTimestamp : Date.now(),
  ).toISOString();

  return {
    id,
    title,
    folderName: candidate.folderName,
    containerKind: candidate.containerKind,
    updatedAt,
    pdf: pdfMatch ? toFile(pdfMatch.relativePath, pdfMatch.stat) : null,
    source: sourceMatch ? toFile(sourceMatch.relativePath, sourceMatch.stat) : null,
    abstract,
    publishManifestPresent,
    publication: publicationRecord?.publication ?? null,
    threadId: thread ? ThreadId.makeUnsafe(thread.threadId) : null,
    threadTitle: thread?.threadTitle ?? null,
    threadArchivedAt: thread?.archivedAt ?? null,
    projectId: project ? ProjectId.makeUnsafe(project.projectId) : null,
    projectName: project?.projectName ?? null,
  };
}

// ── Service implementation ──────────────────────────────────────────────

export const makeLocalPapersService = Effect.gen(function* () {
  const serverSettings = yield* ServerSettingsService;
  const orchestrationEngine = yield* OrchestrationEngineService;
  const agentScienceAuth = yield* AgentScienceAuthService;
  const config = yield* ServerConfig;

  const list: LocalPapersServiceShape["list"] = () =>
    Effect.gen(function* () {
      const settings = yield* serverSettings.getSettings;
      const readModel = yield* orchestrationEngine.getReadModel();
      const containerRoot = normalizeWorkspacePath(settings.workspaceRoot);

      return yield* Effect.tryPromise(async () => {
        const candidates = await discoverCandidateFolders(containerRoot);
        const lookups = buildReadModelLookups(readModel);
        const summaries: LocalPaperSummary[] = [];
        for (const candidate of candidates) {
          const summary = await inspectPaperFolder(candidate, lookups);
          if (summary) summaries.push(summary);
        }
        summaries.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
        return summaries;
      });
    }).pipe(Effect.catch(() => Effect.succeed<LocalPaperSummary[]>([])));

  const resolveFilePath: LocalPapersServiceShape["resolveFilePath"] = (paperId, relativePath) =>
    Effect.gen(function* () {
      const settings = yield* serverSettings.getSettings;
      const containerRoot = normalizeWorkspacePath(settings.workspaceRoot);

      return yield* Effect.tryPromise(async () => {
        const folderAbsolutePath = resolvePaperFolderAbsolutePath(paperId, containerRoot);
        if (!folderAbsolutePath) return null;

        const normalized = path.posix
          .normalize(relativePath.trim().replaceAll("\\", "/"))
          .replace(/^\/+/, "");
        if (
          normalized.length === 0 ||
          normalized === "." ||
          normalized.startsWith("../") ||
          path.isAbsolute(normalized)
        ) {
          return null;
        }

        const absolute = path.resolve(folderAbsolutePath, normalized);
        const relativeInsideFolder = path
          .relative(folderAbsolutePath, absolute)
          .replaceAll("\\", "/");
        if (
          relativeInsideFolder.length === 0 ||
          relativeInsideFolder === "." ||
          relativeInsideFolder.startsWith("../") ||
          path.isAbsolute(relativeInsideFolder)
        ) {
          return null;
        }

        const stat = await statFileIfPresent(absolute);
        return stat ? absolute : null;
      });
    }).pipe(Effect.catch(() => Effect.succeed<string | null>(null)));

  const publish: LocalPapersServiceShape["publish"] = (paperId) =>
    Effect.gen(function* () {
      const settings = yield* serverSettings.getSettings.pipe(
        Effect.mapError(
          (error) =>
            new LocalPaperPublishError(
              error instanceof Error && error.message.trim().length > 0
                ? error.message
                : "Unable to read the local workspace settings.",
              500,
            ),
        ),
      );
      const readModel = yield* orchestrationEngine.getReadModel();
      const containerRoot = normalizeWorkspacePath(settings.workspaceRoot);
      const authState = yield* agentScienceAuth.getState.pipe(
        Effect.mapError(
          (error) => new LocalPaperPublishError(error.message, 401),
        ),
      );
      const token = yield* agentScienceAuth.getBearerToken;

      if (authState.status !== "signed-in" || !authState.user || !token) {
        return yield* Effect.fail(
          new LocalPaperPublishError(
            "Connect this device to AgentScience before publishing.",
            401,
          ),
        );
      }
      const signedInUser = authState.user;

      const folderAbsolutePath = resolvePaperFolderAbsolutePath(paperId, containerRoot);
      if (!folderAbsolutePath) {
        return yield* Effect.fail(new LocalPaperPublishError("Paper not found.", 404));
      }

      const candidate = toPaperCandidate(folderAbsolutePath, containerRoot);
      if (!candidate) {
        return yield* Effect.fail(new LocalPaperPublishError("Paper not found.", 404));
      }

      const lookups = buildReadModelLookups(readModel);

      return yield* Effect.tryPromise({
        try: async () => {
          const summary = await inspectPaperFolder(candidate, lookups);
          if (!summary) {
            throw new LocalPaperPublishError("Paper not found.", 404);
          }

          const existingPublication = await readPublicationRecord(folderAbsolutePath);
          const canUpdateExisting =
            existingPublication?.ownerUserId === signedInUser.id &&
            existingPublication.publication.slug.trim().length > 0;

          const requestForm = () =>
            buildPublishFormData({
              folderAbsolutePath,
              summary,
            });

          const sendRequest = async (input: {
            readonly method: "POST" | "PATCH";
            readonly pathname: string;
          }) => {
            const response = await fetch(joinUrl(config.agentScienceBaseUrl, input.pathname), {
              method: input.method,
              headers: {
                authorization: `Bearer ${token}`,
              },
              body: await requestForm(),
            });

            let payload: unknown = null;
            try {
              payload = await response.json();
            } catch {
              payload = null;
            }

            if (!response.ok) {
              const message =
                payload &&
                typeof payload === "object" &&
                !Array.isArray(payload) &&
                typeof (payload as { error?: unknown }).error === "string"
                  ? ((payload as { error: string }).error ?? "").trim()
                  : "";
              throw new LocalPaperPublishError(
                message || `Publish failed (${response.status}).`,
                response.status,
              );
            }

            const publication = parsePublishedPaperResponse(payload, config.agentScienceBaseUrl);
            if (!publication) {
              throw new LocalPaperPublishError(
                "AgentScience accepted the publish request but returned an unexpected response.",
                502,
              );
            }

            return publication;
          };

          let publication: LocalPaperPublication;
          if (canUpdateExisting) {
            try {
              publication = await sendRequest({
                method: "PATCH",
                pathname: `/api/v1/papers/${encodeURIComponent(
                  existingPublication.publication.slug,
                )}`,
              });
            } catch (error) {
              if (
                error instanceof LocalPaperPublishError &&
                error.status === 404
              ) {
                publication = await sendRequest({
                  method: "POST",
                  pathname: "/api/v1/papers",
                });
              } else {
                throw error;
              }
            }
          } else {
            publication = await sendRequest({
              method: "POST",
              pathname: "/api/v1/papers",
            });
          }

          await writePublicationRecord(folderAbsolutePath, {
            ownerUserId: signedInUser.id,
            publication,
          });

          const refreshed = await inspectPaperFolder(candidate, lookups);
          if (!refreshed) {
            throw new LocalPaperPublishError(
              "The paper was published but could not be reloaded locally.",
              500,
            );
          }

          return refreshed;
        },
        catch: (cause) =>
          cause instanceof LocalPaperPublishError
            ? cause
            : new LocalPaperPublishError(
                cause instanceof Error && cause.message.trim().length > 0
                  ? cause.message
                  : "Failed to publish the paper.",
                500,
              ),
      });
    });

  return {
    list,
    resolveFilePath,
    publish,
  } satisfies LocalPapersServiceShape;
});

export const LocalPapersServiceLive = Layer.effect(LocalPapersService, makeLocalPapersService);

// Exported solely for unit tests to exercise the scanner without Effect wiring.
export const __internal = {
  discoverCandidateFolders,
  buildReadModelLookups,
  inspectPaperFolder,
  findShallowestCandidate,
  encodePaperId,
  decodePaperId,
  extractLatexTitle,
  extractLatexAbstract,
  extractLatexAbstractAsync,
  extractMarkdownTitle,
  extractMarkdownAbstract,
  stripLatexComments,
  folderNameToTitle,
  normalizePublicationRecord,
  readPublicationRecord,
  PDF_FILENAME_CANDIDATES,
  TEX_FILENAME_CANDIDATES,
  MD_FILENAME_CANDIDATES,
  MAX_SCAN_DEPTH,
  PUBLISHED_METADATA_FILENAME,
};
