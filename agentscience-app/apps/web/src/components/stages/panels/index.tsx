/**
 * Per-stage right-canvas content. Each panel receives the project's
 * stage state plus a Preview / Source view toggle; rendering preserves
 * the same visual rhythm as PaperReviewPanel.
 *
 * Source view exposes the underlying Markdown / JSON for power users.
 * Preview renders the artifact as the user would see it in the final
 * paper (KaTeX inline math, image preview, etc.).
 */

import {
  type ProjectStageState,
  workflowStageDisplayName,
} from "@agentscience/contracts";
import { type ReactNode } from "react";

import ChatMarkdown from "../../ChatMarkdown";
import { getStageArtifact } from "../../../stages/stageStore";

type CanvasView = "preview" | "source";

interface BasePanelProps {
  state: ProjectStageState;
  view: CanvasView;
}

// ---------------------------------------------------------------------------
// Question stage
// ---------------------------------------------------------------------------

export function QuestionStagePanel({ state, view }: BasePanelProps) {
  const artifact = getStageArtifact(state, "question");
  if (!artifact) return null;
  if (view === "source") {
    return <SourceView value={JSON.stringify(artifact, null, 2)} />;
  }
  return (
    <PanelShell>
      <h1 className="font-display text-[1.65rem] leading-tight text-foreground">
        <ChatMarkdown text={artifact.titleMd} cwd={undefined} isStreaming={false} />
      </h1>
      <SectionLabel>Hypothesis</SectionLabel>
      <div className="prose-paper">
        <ChatMarkdown text={artifact.statementMd} cwd={undefined} isStreaming={false} />
      </div>
      {artifact.assumptions.length > 0 && (
        <>
          <SectionLabel>Assumptions</SectionLabel>
          <ul className="list-disc space-y-1 pl-5 text-sm text-foreground">
            {artifact.assumptions.map((assumption, index) => (
              <li key={index} className="leading-relaxed">
                {assumption}
              </li>
            ))}
          </ul>
        </>
      )}
    </PanelShell>
  );
}

// ---------------------------------------------------------------------------
// Novelty stage
// ---------------------------------------------------------------------------

export function NoveltyStagePanel({ state, view }: BasePanelProps) {
  const artifact = getStageArtifact(state, "novelty");
  if (!artifact) return null;
  if (view === "source") {
    return <SourceView value={JSON.stringify(artifact, null, 2)} />;
  }
  return (
    <PanelShell>
      <SectionLabel>Novelty assessment</SectionLabel>
      <div className="prose-paper">
        <ChatMarkdown text={artifact.summaryMd} cwd={undefined} isStreaming={false} />
      </div>
      {artifact.priorWork.length > 0 && (
        <>
          <SectionLabel>Prior work</SectionLabel>
          <div className="overflow-x-auto rounded-lg border border-border/70">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-card/60 text-[10px] uppercase tracking-[0.14em] text-muted-foreground/80">
                <tr>
                  <th className="px-3 py-2">Title</th>
                  <th className="px-3 py-2">Claim</th>
                  <th className="px-3 py-2">Similarity</th>
                  <th className="px-3 py-2">Note</th>
                </tr>
              </thead>
              <tbody>
                {artifact.priorWork.map((row, index) => (
                  <tr key={index} className="border-t border-border/60 align-top">
                    <td className="px-3 py-2 font-medium text-foreground">{row.title}</td>
                    <td className="px-3 py-2 text-foreground">{row.claim}</td>
                    <td className="px-3 py-2 text-muted-foreground uppercase tracking-[0.12em] text-[10px]">
                      {row.similarity}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">
                      <ChatMarkdown text={row.noteMd} cwd={undefined} isStreaming={false} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </PanelShell>
  );
}

// ---------------------------------------------------------------------------
// Data stage
// ---------------------------------------------------------------------------

export function DataStagePanel({ state, view }: BasePanelProps) {
  const artifact = getStageArtifact(state, "data");
  if (!artifact) return null;
  if (view === "source") {
    return <SourceView value={JSON.stringify(artifact, null, 2)} />;
  }
  return (
    <PanelShell>
      <SectionLabel>Datasets</SectionLabel>
      <div className="space-y-3">
        {artifact.datasets.map((ds) => (
          <div
            key={ds.id}
            className="rounded-xl border border-border/70 bg-card/40 p-4"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="text-base font-medium text-foreground">{ds.label}</h3>
                <p className="mt-0.5 truncate text-[11px] text-muted-foreground/80">
                  {ds.source}
                </p>
              </div>
              {typeof ds.rowCount === "number" && (
                <p className="shrink-0 text-[10px] uppercase tracking-[0.14em] text-muted-foreground/65">
                  {ds.rowCount} rows
                </p>
              )}
            </div>
            <div className="prose-paper mt-2 text-sm">
              <ChatMarkdown text={ds.provenanceMd} cwd={undefined} isStreaming={false} />
            </div>
            {ds.columns && ds.columns.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {ds.columns.map((col) => (
                  <span
                    key={col}
                    className="rounded-md border border-border/70 bg-background px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground"
                  >
                    {col}
                  </span>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </PanelShell>
  );
}

// ---------------------------------------------------------------------------
// Method stage
// ---------------------------------------------------------------------------

export function MethodStagePanel({ state, view }: BasePanelProps) {
  const artifact = getStageArtifact(state, "method");
  if (!artifact) return null;
  if (view === "source") {
    return <SourceView value={artifact.methodMd} />;
  }
  return (
    <PanelShell>
      <SectionLabel>Method</SectionLabel>
      <div className="prose-paper">
        <ChatMarkdown text={artifact.methodMd} cwd={undefined} isStreaming={false} />
      </div>
      {artifact.requiredTools.length > 0 && (
        <>
          <SectionLabel>Required tools</SectionLabel>
          <div className="flex flex-wrap gap-1.5">
            {artifact.requiredTools.map((tool) => (
              <span
                key={tool}
                className="rounded-md border border-border/70 bg-background px-1.5 py-0.5 font-mono text-[11px] text-foreground"
              >
                {tool}
              </span>
            ))}
          </div>
        </>
      )}
    </PanelShell>
  );
}

// ---------------------------------------------------------------------------
// Analysis stage  (the screenshot's reference layout)
// ---------------------------------------------------------------------------

export function AnalysisStagePanel({ state, view }: BasePanelProps) {
  const artifact = getStageArtifact(state, "analysis");
  if (!artifact) return null;
  if (view === "source") {
    return (
      <SourceView
        value={[`# Caption`, "", artifact.captionMd, "", `## Methods text`, "", artifact.methodsTextMd ?? "(none)"].join("\n")}
      />
    );
  }
  return (
    <PanelShell>
      <FigureFrame url={artifact.figureRef.url} alt={artifact.figureRef.alt} />
      <div className="prose-paper text-sm">
        <ChatMarkdown text={artifact.captionMd} cwd={undefined} isStreaming={false} />
      </div>
      {artifact.methodsTextMd && (
        <>
          <SectionLabel>Methods text</SectionLabel>
          <div className="prose-paper text-sm">
            <ChatMarkdown text={artifact.methodsTextMd} cwd={undefined} isStreaming={false} />
          </div>
        </>
      )}
      {artifact.codeRef && (
        <>
          <SectionLabel>Generating code</SectionLabel>
          <p className="font-mono text-[11px] text-muted-foreground">
            {artifact.codeRef.language} · {artifact.codeRef.relativePath}
          </p>
        </>
      )}
    </PanelShell>
  );
}

// ---------------------------------------------------------------------------
// Figures stage
// ---------------------------------------------------------------------------

export function FiguresStagePanel({ state, view }: BasePanelProps) {
  const artifact = getStageArtifact(state, "figures");
  if (!artifact) return null;
  if (view === "source") {
    return <SourceView value={JSON.stringify(artifact, null, 2)} />;
  }
  return (
    <PanelShell>
      <SectionLabel>Figures</SectionLabel>
      <div className="space-y-6">
        {artifact.figures.map((fig) => (
          <figure key={fig.id} className="space-y-2">
            <FigureFrame
              url={fig.figureRef.url}
              alt={fig.figureRef.alt}
            />
            <figcaption className="prose-paper text-sm">
              <p className="font-medium text-foreground">{fig.titleMd}</p>
              <ChatMarkdown text={fig.captionMd} cwd={undefined} isStreaming={false} />
            </figcaption>
          </figure>
        ))}
      </div>
    </PanelShell>
  );
}

// ---------------------------------------------------------------------------
// Draft stage
// ---------------------------------------------------------------------------

export function DraftStagePanel({ state, view }: BasePanelProps) {
  const artifact = getStageArtifact(state, "draft");
  if (!artifact) return null;
  if (view === "source") {
    return (
      <SourceView
        value={artifact.sections
          .map((section) => `## ${section.titleMd}\n\n${section.bodyMd}`)
          .join("\n\n---\n\n")}
      />
    );
  }
  return (
    <PanelShell>
      <SectionLabel>{workflowStageDisplayName(state.workflowMode, "draft")}</SectionLabel>
      <article className="space-y-6">
        {artifact.sections.map((section) => (
          <section key={section.id} className="space-y-2">
            <h2 className="font-display text-[1.25rem] text-foreground">
              {section.titleMd}
            </h2>
            <div className="prose-paper">
              <ChatMarkdown
                text={section.bodyMd}
                cwd={undefined}
                isStreaming={false}
              />
            </div>
          </section>
        ))}
      </article>
    </PanelShell>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function PanelShell({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto max-w-3xl space-y-4 px-5 py-6 sm:px-6">{children}</div>
  );
}

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <div className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground/70">
      {children}
    </div>
  );
}

function SourceView({ value }: { value: string }) {
  return (
    <div className="px-5 py-6">
      <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded-lg border border-border/80 bg-card px-4 py-4 font-mono text-[12px] leading-6 text-foreground">
        {value}
      </pre>
    </div>
  );
}

function FigureFrame({
  url,
  alt,
}: {
  url: string;
  alt: string;
}) {
  return (
    <div className="overflow-hidden rounded-lg border border-border/70 bg-card/30">
      <img src={url} alt={alt} className="h-auto w-full" />
    </div>
  );
}
