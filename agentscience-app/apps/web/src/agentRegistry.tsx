import type { LucideIcon } from "lucide-react";
import {
  BarChart3Icon,
  LandmarkIcon,
  MapIcon,
  MicroscopeIcon,
} from "lucide-react";

import { cn } from "./lib/utils";
import type { PaperWorkflowMode } from "./paperWorkflowModes";

export type SpecialistAgentMode = Exclude<PaperWorkflowMode, "general-agent" | "open">;
export type SourceBlockKind = "paste" | "dropzone" | "searchPick";

interface SourceLinkConfig {
  label: string;
  icon: "search" | "upload" | "file" | "folder" | "paste" | "template" | "code" | "database" | "document";
}

interface PasteSourceBlockConfig {
  kind: "paste";
  fieldHead: string;
  hint: string;
  placeholder: string;
  sourceLinks: readonly SourceLinkConfig[];
}

interface DropzoneSourceBlockConfig {
  kind: "dropzone";
  dropTitle: string;
  dropSub: string;
  sourceLinks: readonly SourceLinkConfig[];
}

interface SearchPickSourceBlockConfig {
  kind: "searchPick";
  fieldHead: string;
  browseLink: string;
  leadIcon: "database" | "link";
  placeholder: string;
  addLabel: string;
  picks: {
    label: string;
    chips: readonly string[];
    chipIcon: "database" | null;
  };
  sourceLinks: readonly SourceLinkConfig[];
}

export type SourceBlockConfig =
  | PasteSourceBlockConfig
  | DropzoneSourceBlockConfig
  | SearchPickSourceBlockConfig;

export interface AgentConfig {
  id: SpecialistAgentMode;
  name: string;
  icon: LucideIcon;
  chooserDesc: string;
  title: string;
  lede: string;
  sourceBlock: SourceBlockConfig;
  startLabel: string;
  startPrompt: string;
  composerPlaceholder: string;
}

export const AGENT_CONFIGS = [
  {
    id: "literature-review",
    name: "Literature review",
    icon: MapIcon,
    chooserDesc: "Survey sources and synthesize what is known.",
    title: "Survey what's known",
    lede: "Start from papers you already trust, then ask the agent to map the field.",
    sourceBlock: {
      kind: "paste",
      fieldHead: "Papers you already have",
      hint: "PMIDs, DOIs, URLs, or citations",
      placeholder:
        "32842672\n10.1038/s41586-023-06887-8\nhttps://pubmed.ncbi.nlm.nih.gov/35414745/",
      sourceLinks: [
        { label: "Search databases", icon: "search" },
        { label: "Upload PDFs", icon: "upload" },
        { label: "Import .bib / .ris", icon: "file" },
      ],
    },
    startLabel: "Start review",
    startPrompt: "Start the literature review using the intake context and attached files.",
    composerPlaceholder: "Describe what you want to review, or paste papers above",
  },
  {
    id: "experimental-design",
    name: "Experimental design",
    icon: MicroscopeIcon,
    chooserDesc: "Develop hypotheses, controls, and a preregistration-ready protocol.",
    title: "Design the experiment",
    lede: "Point the agent at prior work, protocols, and constraints before it designs.",
    sourceBlock: {
      kind: "dropzone",
      dropTitle: "Drop existing work here",
      dropSub:
        "Proposals, drafts, protocols, pilot data, or related papers. Or click to browse.",
      sourceLinks: [
        { label: "Connect a folder", icon: "folder" },
        { label: "Paste a draft", icon: "paste" },
        { label: "Use a template", icon: "template" },
      ],
    },
    startLabel: "Start design",
    startPrompt: "Design the experiment using the intake context and attached files.",
    composerPlaceholder:
      "Describe the question you want to test, or attach existing work above",
  },
  {
    id: "data-analysis",
    name: "Data analysis",
    icon: BarChart3Icon,
    chooserDesc: "Work from a dataset toward results.",
    title: "Analyze your data",
    lede: "Connect a dataset, code, or prior analysis so the agent starts from evidence.",
    sourceBlock: {
      kind: "searchPick",
      fieldHead: "Your dataset",
      browseLink: "Browse registry",
      leadIcon: "database",
      placeholder: "Search saved datasets, paste a URL, or name a local file",
      addLabel: "Add",
      picks: {
        label: "Recent",
        chips: ["NHANES 2017-2018", "MIMIC-IV", "pilot_data.csv"],
        chipIcon: "database",
      },
      sourceLinks: [
        { label: "Bring in code", icon: "code" },
        { label: "Connect a database", icon: "database" },
        { label: "Browse the registry", icon: "search" },
      ],
    },
    startLabel: "Start analysis",
    startPrompt: "Analyze the data using the intake context and attached files.",
    composerPlaceholder:
      "Describe what you want to find in the data, or connect a dataset above",
  },
  {
    id: "grant-writing",
    name: "Grant writer",
    icon: LandmarkIcon,
    chooserDesc: "Shape aims, evidence, milestones, and reviewer-facing narrative.",
    title: "Write the grant",
    lede: "Start with the call or mechanism so aims, page limits, and review criteria line up.",
    sourceBlock: {
      kind: "searchPick",
      fieldHead: "Funding target",
      browseLink: "Browse mechanisms",
      leadIcon: "link",
      placeholder: "Search NIH/NSF mechanisms, paste an RFP URL, or name the call",
      addLabel: "Add",
      picks: {
        label: "Common",
        chips: ["NIH R01", "NIH R21", "NSF CAREER", "Sloan"],
        chipIcon: null,
      },
      sourceLinks: [
        { label: "Bring in prior drafts", icon: "document" },
        { label: "Attach preliminary data", icon: "database" },
        { label: "Use a template", icon: "template" },
      ],
    },
    startLabel: "Start grant",
    startPrompt: "Write the grant using the intake context and attached files.",
    composerPlaceholder: "Describe what you're applying for, or add the funding call above",
  },
] as const satisfies readonly AgentConfig[];

export const AGENT_CONFIG_BY_MODE: Record<SpecialistAgentMode, AgentConfig> =
  AGENT_CONFIGS.reduce(
    (configs, agent) => {
      configs[agent.id] = agent;
      return configs;
    },
    {} as Record<SpecialistAgentMode, AgentConfig>,
  );

export function isSpecialistAgentMode(mode: unknown): mode is SpecialistAgentMode {
  return (
    mode === "literature-review" ||
    mode === "experimental-design" ||
    mode === "data-analysis" ||
    mode === "grant-writing"
  );
}

export function AgentGlyph({
  agent,
  active = false,
  className,
}: {
  agent: Pick<AgentConfig, "icon" | "name">;
  active?: boolean;
  className?: string;
}) {
  const Icon = agent.icon;
  return (
    <Icon
      aria-hidden="true"
      className={cn(
        "shrink-0 text-ink-light transition-colors duration-150 ease-linear group-hover:text-brand group-focus-visible:text-brand",
        active && "text-brand",
        className,
      )}
      strokeWidth={1.6}
    />
  );
}
