import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { __internal } from "./localPapers";

/**
 * These tests protect the one thing that actually matters here: whenever an
 * agent nests `paper.pdf` inside `manuscript/`, `workspace/`, etc., we still
 * discover the paper. A flat scan already existed; this contract is about
 * making the scan recursive without over-matching build artifacts or walking
 * into `.venv`/`node_modules`.
 */
describe("localPapers __internal.findShallowestCandidate", () => {
  async function makeTempDir(): Promise<string> {
    return fs.mkdtemp(path.join(os.tmpdir(), "agentscience-local-papers-"));
  }

  it("finds paper.pdf at the folder root", async () => {
    const root = await makeTempDir();
    await fs.writeFile(path.join(root, "paper.pdf"), "%PDF-1.4");

    const match = await __internal.findShallowestCandidate(
      root,
      __internal.PDF_FILENAME_CANDIDATES,
      __internal.MAX_SCAN_DEPTH,
    );

    expect(match?.relativePath).toBe("paper.pdf");
  });

  it("finds a paper.pdf nested under manuscript/ (the venture-investing case)", async () => {
    const root = await makeTempDir();
    const nested = path.join(root, "manuscript");
    await fs.mkdir(nested, { recursive: true });
    await fs.writeFile(path.join(nested, "paper.tex"), "\\title{Paper One}\n");
    await fs.writeFile(path.join(nested, "paper.pdf"), "%PDF-1.4");

    const pdfMatch = await __internal.findShallowestCandidate(
      root,
      __internal.PDF_FILENAME_CANDIDATES,
      __internal.MAX_SCAN_DEPTH,
    );
    const texMatch = await __internal.findShallowestCandidate(
      root,
      __internal.TEX_FILENAME_CANDIDATES,
      __internal.MAX_SCAN_DEPTH,
    );

    expect(pdfMatch?.relativePath).toBe("manuscript/paper.pdf");
    expect(texMatch?.relativePath).toBe("manuscript/paper.tex");
  });

  it("finds a paper.pdf nested under workspace/ (the venture-investing-2 case)", async () => {
    const root = await makeTempDir();
    const nested = path.join(root, "workspace");
    await fs.mkdir(nested, { recursive: true });
    await fs.writeFile(path.join(nested, "paper.pdf"), "%PDF-1.4");

    const match = await __internal.findShallowestCandidate(
      root,
      __internal.PDF_FILENAME_CANDIDATES,
      __internal.MAX_SCAN_DEPTH,
    );

    expect(match?.relativePath).toBe("workspace/paper.pdf");
  });

  it("prefers a root paper.pdf over a nested manuscript.pdf at the same name", async () => {
    // Two candidates at different depths: the shallower wins.
    const root = await makeTempDir();
    await fs.writeFile(path.join(root, "paper.pdf"), "%PDF-1.4 shallow");
    const nested = path.join(root, "backup");
    await fs.mkdir(nested, { recursive: true });
    await fs.writeFile(path.join(nested, "paper.pdf"), "%PDF-1.4 deep");

    const match = await __internal.findShallowestCandidate(
      root,
      __internal.PDF_FILENAME_CANDIDATES,
      __internal.MAX_SCAN_DEPTH,
    );

    expect(match?.relativePath).toBe("paper.pdf");
  });

  it("prefers paper.pdf over manuscript.pdf when both are at the same depth", async () => {
    const root = await makeTempDir();
    await fs.writeFile(path.join(root, "manuscript.pdf"), "%PDF-1.4");
    await fs.writeFile(path.join(root, "paper.pdf"), "%PDF-1.4");

    const match = await __internal.findShallowestCandidate(
      root,
      __internal.PDF_FILENAME_CANDIDATES,
      __internal.MAX_SCAN_DEPTH,
    );

    expect(match?.relativePath).toBe("paper.pdf");
  });

  it("does not walk into ignored directories like node_modules or .venv", async () => {
    const root = await makeTempDir();
    const venv = path.join(root, ".venv");
    await fs.mkdir(venv, { recursive: true });
    await fs.writeFile(path.join(venv, "paper.pdf"), "%PDF-1.4");
    const nodeModules = path.join(root, "node_modules", "some-pkg");
    await fs.mkdir(nodeModules, { recursive: true });
    await fs.writeFile(path.join(nodeModules, "paper.pdf"), "%PDF-1.4");

    const match = await __internal.findShallowestCandidate(
      root,
      __internal.PDF_FILENAME_CANDIDATES,
      __internal.MAX_SCAN_DEPTH,
    );

    // Neither ignored location should produce a match.
    expect(match).toBeNull();
  });

  it("returns null for a folder that has source-like files but no paper.pdf / paper.tex", async () => {
    const root = await makeTempDir();
    await fs.writeFile(path.join(root, "abstract.txt"), "hello");
    await fs.writeFile(path.join(root, "notes.md"), "not a paper");

    const pdfMatch = await __internal.findShallowestCandidate(
      root,
      __internal.PDF_FILENAME_CANDIDATES,
      __internal.MAX_SCAN_DEPTH,
    );
    const texMatch = await __internal.findShallowestCandidate(
      root,
      __internal.TEX_FILENAME_CANDIDATES,
      __internal.MAX_SCAN_DEPTH,
    );
    const mdMatch = await __internal.findShallowestCandidate(
      root,
      __internal.MD_FILENAME_CANDIDATES,
      __internal.MAX_SCAN_DEPTH,
    );

    expect(pdfMatch).toBeNull();
    expect(texMatch).toBeNull();
    expect(mdMatch).toBeNull();
  });

  it("respects the depth cap", async () => {
    const root = await makeTempDir();
    const deep = path.join(root, "a", "b", "c", "d", "e", "f");
    await fs.mkdir(deep, { recursive: true });
    await fs.writeFile(path.join(deep, "paper.pdf"), "%PDF-1.4");

    const match = await __internal.findShallowestCandidate(
      root,
      __internal.PDF_FILENAME_CANDIDATES,
      2, // tight depth cap: shouldn't reach six levels deep
    );

    expect(match).toBeNull();
  });
});

describe("localPapers __internal.extractLatexTitle", () => {
  it("reads a single-line \\title{...}", () => {
    const source = "\\title{Micro-Reallocation in Federal Grant Funding}\n\\author{Ada}";
    expect(__internal.extractLatexTitle(source)).toBe(
      "Micro-Reallocation in Federal Grant Funding",
    );
  });

  it("reads a multi-line title written as \\title{% \\n body \\n }", () => {
    // This is the AgentScience paper-template pattern that regressed in the
    // real workspace — the leading `%` is a LaTeX line comment and the
    // body starts on the next line.
    const source =
      "\\title{%\n  From Acceleration to Reset: A Decade of Venture Investing in U.S. Healthtech, 2015--2024\n}\n";
    expect(__internal.extractLatexTitle(source)).toBe(
      "From Acceleration to Reset: A Decade of Venture Investing in U.S. Healthtech, 2015--2024",
    );
  });

  it("does not misfire on \\titleformat from the template preamble", () => {
    // The AgentScience template contains `\titleformat{\section}{...}` for
    // sectioning. A naive `indexOf("\\title")` would match that instead of
    // the real `\title{...}` further down the document.
    const source = [
      "\\IfFileExists{titlesec.sty}{%",
      "  \\usepackage{titlesec}",
      "  \\titleformat{\\section}{\\normalfont\\large\\bfseries}{\\thesection}{1em}{}",
      "}{}",
      "",
      "\\title{The Real Title}",
      "\\author{Ada}",
    ].join("\n");
    expect(__internal.extractLatexTitle(source)).toBe("The Real Title");
  });

  it("returns null when there is no \\title macro", () => {
    expect(__internal.extractLatexTitle("\\titleformat{\\section}{...}{}{}{}")).toBeNull();
  });

  it("strips simple formatting macros inside a title", () => {
    expect(
      __internal.extractLatexTitle("\\title{\\textbf{Bold} Title}"),
    ).toBe("Bold Title");
  });
});

describe("localPapers __internal.extractLatexAbstract", () => {
  it("reads a classic \\begin{abstract}...\\end{abstract}", () => {
    const source = "\\begin{abstract}\nA study of X in Y.\n\\end{abstract}\n";
    expect(__internal.extractLatexAbstract(source)).toBe("A study of X in Y.");
  });

  it("reads the AgentScience template's \\renewcommand{\\paperabstract}{...}", () => {
    const source = [
      "\\newcommand{\\paperabstract}{}  % placeholder",
      "\\renewcommand{\\paperabstract}{%",
      "This paper examines healthtech venture investing. Funding grew from \\$4.6B in 2015 to \\$8.2B in 2019.",
      "}",
    ].join("\n");
    const abstract = __internal.extractLatexAbstract(source);
    expect(abstract).not.toBeNull();
    expect(abstract).toContain("This paper examines healthtech");
    // Escaped dollar signs should come through as plain dollars.
    expect(abstract).toContain("$4.6B");
  });

  it("prefers a non-empty \\renewcommand over the placeholder \\newcommand", () => {
    const source = [
      "\\newcommand{\\paperabstract}{}",
      "\\renewcommand{\\paperabstract}{Real abstract body.}",
    ].join("\n");
    expect(__internal.extractLatexAbstract(source)).toBe("Real abstract body.");
  });

  it("returns null when no abstract construct is present", () => {
    expect(__internal.extractLatexAbstract("\\title{Just a title}")).toBeNull();
  });
});

describe("localPapers __internal.extractLatexAbstractAsync", () => {
  async function makeTempDir(): Promise<string> {
    return fs.mkdtemp(path.join(os.tmpdir(), "agentscience-abstract-input-"));
  }

  it("resolves \\input{abstract.txt} from a sibling file", async () => {
    // This mirrors paper 1 in the real workspace: the LaTeX file has
    // `\begin{abstract}\n\input{abstract.txt}\n\end{abstract}` and the
    // prose lives in a separate text file.
    const root = await makeTempDir();
    await fs.writeFile(
      path.join(root, "abstract.txt"),
      "This paper studies whether COVID-era funding expanded grant access.\n",
    );
    const source =
      "\\begin{abstract}\n\\input{abstract.txt}\n\\end{abstract}\n\\section{Intro}\n";
    const result = await __internal.extractLatexAbstractAsync(source, root);
    expect(result).toBe(
      "This paper studies whether COVID-era funding expanded grant access.",
    );
  });

  it("resolves \\input{abstract} without an extension", async () => {
    const root = await makeTempDir();
    await fs.writeFile(path.join(root, "abstract.tex"), "Short body.\n");
    const source = "\\begin{abstract}\n\\input{abstract}\n\\end{abstract}\n";
    const result = await __internal.extractLatexAbstractAsync(source, root);
    expect(result).toBe("Short body.");
  });

  it("refuses to traverse outside the paper folder via \\input{..}", async () => {
    const root = await makeTempDir();
    await fs.writeFile(path.join(root, "abstract.txt"), "Fine body.");
    // Attempt to read a file above the paper folder; should be ignored.
    const source = "\\begin{abstract}\n\\input{../../etc/passwd}\n\\end{abstract}\n";
    const result = await __internal.extractLatexAbstractAsync(source, root);
    // Without a resolvable include, falls through to finalizing the raw
    // body — which here is just the `\input` macro (stripped to empty).
    expect(result).toBeNull();
  });
});

describe("localPapers __internal.extractMarkdownAbstract", () => {
  it("reads the paragraph under an '## Abstract' heading", () => {
    const source = [
      "# Paper Title",
      "",
      "## Abstract",
      "This paper explores Z.",
      "",
      "## Introduction",
      "We begin with...",
    ].join("\n");
    expect(__internal.extractMarkdownAbstract(source)).toBe("This paper explores Z.");
  });

  it("returns null when no Abstract heading exists", () => {
    expect(__internal.extractMarkdownAbstract("# Title\n\nBody.")).toBeNull();
  });
});

describe("localPapers __internal.inspectPaperFolder", () => {
  async function makeTempDir(): Promise<string> {
    return fs.mkdtemp(path.join(os.tmpdir(), "agentscience-local-papers-inspect-"));
  }

  it("surfaces a paper when the PDF is nested under manuscript/", async () => {
    const root = await makeTempDir();
    const manuscript = path.join(root, "manuscript");
    await fs.mkdir(manuscript, { recursive: true });
    await fs.writeFile(
      path.join(manuscript, "paper.tex"),
      "\\title{Micro-Reallocation}\n\\begin{document}\n",
    );
    await fs.writeFile(path.join(manuscript, "paper.pdf"), "%PDF-1.4");

    const lookups = __internal.buildReadModelLookups({ threads: [], projects: [] });
    const summary = await __internal.inspectPaperFolder(
      {
        folderAbsolutePath: root,
        folderName: path.basename(root),
        containerKind: "paper",
        projectFolderAbsolutePath: null,
        projectFolderSlug: null,
      },
      lookups,
    );

    expect(summary).not.toBeNull();
    expect(summary?.title).toBe("Micro-Reallocation");
    expect(summary?.pdf?.relativePath).toBe("manuscript/paper.pdf");
    expect(summary?.source?.relativePath).toBe("manuscript/paper.tex");
    // The URL should include the nested subpath so downloads hit the right file.
    expect(summary?.pdf?.url).toContain("/files/manuscript/paper.pdf");
  });

  it("returns null when the folder has only build artifacts (no paper.pdf / paper.tex)", async () => {
    const root = await makeTempDir();
    await fs.writeFile(path.join(root, "abstract.txt"), "only notes");
    await fs.writeFile(path.join(root, "experiment-log.md"), "not paper.md");

    const lookups = __internal.buildReadModelLookups({ threads: [], projects: [] });
    const summary = await __internal.inspectPaperFolder(
      {
        folderAbsolutePath: root,
        folderName: path.basename(root),
        containerKind: "paper",
        projectFolderAbsolutePath: null,
        projectFolderSlug: null,
      },
      lookups,
    );

    expect(summary).toBeNull();
  });
});
