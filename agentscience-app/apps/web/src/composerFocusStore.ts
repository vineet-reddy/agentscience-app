/**
 * Fire-and-forget focus signal for the chat composer.
 *
 * The empty state (and any future surface that seeds the composer) needs
 * a way to focus the editor without pulling a ref down through React.
 * Subscribers watch `token`; it increments on every `requestFocus` call.
 * `threadId` scopes the request so a stale thread can't yank focus.
 */
import { type ThreadId } from "@agentscience/contracts";
import { create } from "zustand";

interface ComposerFocusState {
  token: number;
  threadId: ThreadId | null;
  /** Optional prompt to seed before focusing. */
  seedPrompt: string | null;
  requestFocus: (input: { threadId: ThreadId; seedPrompt?: string | null }) => void;
  consume: () => void;
}

export const useComposerFocusStore = create<ComposerFocusState>()((set) => ({
  token: 0,
  threadId: null,
  seedPrompt: null,
  requestFocus: ({ threadId, seedPrompt = null }) => {
    set((state) => ({
      token: state.token + 1,
      threadId,
      seedPrompt,
    }));
  },
  consume: () => {
    set(() => ({ seedPrompt: null }));
  },
}));
