import { type ThreadId } from "@agentscience/contracts";
import { create } from "zustand";

interface ComposerAutoSubmitState {
  token: number;
  threadId: ThreadId | null;
  requestSubmit: (input: { threadId: ThreadId }) => void;
  consume: (token: number) => void;
}

export const useComposerAutoSubmitStore = create<ComposerAutoSubmitState>()((set, get) => ({
  token: 0,
  threadId: null,
  requestSubmit: ({ threadId }) => {
    set((state) => ({
      token: state.token + 1,
      threadId,
    }));
  },
  consume: (token) => {
    if (get().token !== token) return;
    set({ threadId: null });
  },
}));
