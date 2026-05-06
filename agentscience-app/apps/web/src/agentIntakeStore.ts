import type { ThreadId } from "@agentscience/contracts";
import { create } from "zustand";

import type { PaperWorkflowMode } from "./paperWorkflowModes";

export interface AgentIntakeEntry {
  id: string;
  label: string;
  value: string;
}

export interface AgentIntakeContext {
  mode: Exclude<PaperWorkflowMode, "general-agent" | "open">;
  entries: AgentIntakeEntry[];
  updatedAt: string;
}

interface AgentIntakeStoreState {
  contextsByThreadId: Record<ThreadId, AgentIntakeContext>;
  upsertEntry: (
    threadId: ThreadId,
    mode: AgentIntakeContext["mode"],
    entry: AgentIntakeEntry,
  ) => void;
  removeEntry: (threadId: ThreadId, entryId: string) => void;
  clearContext: (threadId: ThreadId) => void;
}

const AGENT_INTAKE_LABEL_BY_MODE: Record<AgentIntakeContext["mode"], string> = {
  "literature-review": "Literature review",
  "experimental-design": "Experimental design",
  "data-analysis": "Data analysis",
  "grant-writing": "Grant writing",
};

export const useAgentIntakeStore = create<AgentIntakeStoreState>()((set) => ({
  contextsByThreadId: {},
  upsertEntry: (threadId, mode, entry) => {
    const value = entry.value.trim();
    set((state) => {
      const existing = state.contextsByThreadId[threadId] ?? {
        mode,
        entries: [],
        updatedAt: new Date(0).toISOString(),
      };
      const withoutEntry = existing.entries.filter((candidate) => candidate.id !== entry.id);
      const entries =
        value.length > 0 ? [...withoutEntry, { ...entry, value }] : withoutEntry;
      const contextsByThreadId = { ...state.contextsByThreadId };
      if (entries.length === 0) {
        delete contextsByThreadId[threadId];
      } else {
        contextsByThreadId[threadId] = {
          mode,
          entries,
          updatedAt: new Date().toISOString(),
        };
      }
      return { contextsByThreadId };
    });
  },
  removeEntry: (threadId, entryId) => {
    set((state) => {
      const existing = state.contextsByThreadId[threadId];
      if (!existing) return state;
      const entries = existing.entries.filter((entry) => entry.id !== entryId);
      const contextsByThreadId = { ...state.contextsByThreadId };
      if (entries.length === 0) {
        delete contextsByThreadId[threadId];
      } else {
        contextsByThreadId[threadId] = {
          ...existing,
          entries,
          updatedAt: new Date().toISOString(),
        };
      }
      return { contextsByThreadId };
    });
  },
  clearContext: (threadId) => {
    set((state) => {
      if (!state.contextsByThreadId[threadId]) return state;
      const contextsByThreadId = { ...state.contextsByThreadId };
      delete contextsByThreadId[threadId];
      return { contextsByThreadId };
    });
  },
}));

export function appendAgentIntakeContextToPrompt(
  prompt: string,
  context: AgentIntakeContext | null | undefined,
): string {
  if (!context || context.entries.length === 0) {
    return prompt;
  }

  const visiblePrompt = prompt.trim();
  const contextLines = context.entries.flatMap((entry) => {
    const value = entry.value.trim();
    if (value.length === 0) return [];
    return [`${entry.label}:`, value];
  });
  if (contextLines.length === 0) {
    return prompt;
  }

  const heading = `Agent intake context (${AGENT_INTAKE_LABEL_BY_MODE[context.mode]}):`;
  return [
    visiblePrompt.length > 0 ? visiblePrompt : "Start this agent task from the intake context.",
    "",
    heading,
    ...contextLines,
  ].join("\n");
}
