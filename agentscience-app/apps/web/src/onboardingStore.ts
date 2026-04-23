/**
 * Onboarding state, persisted to localStorage.
 *
 * This stays on the client by design. The spec asks for two tags on the user
 * profile — `field` and `data_interests` — but the server-side settings
 * contract has no notion of user profile yet, and adding one here would
 * ripple through the contracts package, the desktop RPC, and the embedded
 * server. The onboarding flow is a local product decision: which screens do
 * we show, which chips did they tap. Keeping it local-only lets us ship the
 * UI end-to-end and hoist it onto the server profile later without
 * reshuffling the component tree.
 *
 * The one field that matters for returning-user semantics is
 * `welcomeGreetingConsumed`: the first-thread "Welcome to AgentScience"
 * greeting can only fire once, and it must survive reloads.
 */
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { FieldTag } from "./onboardingCatalog";

export interface OnboardingProfile {
  /** Up to two field tags selected in question 1. */
  field: ReadonlyArray<FieldTag>;
  /**
   * Free-form text the user typed after tapping "Other" on question 1.
   * Null if they never tapped Other (or cleared it).
   */
  fieldOther: string | null;
  /** Up to two data-interest ids selected in question 2. */
  dataInterests: ReadonlyArray<string>;
  /**
   * Dataset/provider slugs we pre-connected to the workspace based on the
   * data-interest selection. Text-only interests (own-lab, other) don't
   * appear here — they're still in `dataInterests` for ranking signal.
   */
  autoConnectedDatasets: ReadonlyArray<{ kind: "dataset" | "provider"; slug: string }>;
}

export interface OnboardingState {
  completed: boolean;
  skipped: boolean;
  completedAt: string | null;
  /** Tracks whether the one-time Case A welcome has already been shown. */
  welcomeGreetingConsumed: boolean;
  profile: OnboardingProfile;

  setField: (field: ReadonlyArray<FieldTag>) => void;
  setFieldOther: (text: string | null) => void;
  setDataInterests: (ids: ReadonlyArray<string>) => void;
  setAutoConnectedDatasets: (
    entries: ReadonlyArray<{ kind: "dataset" | "provider"; slug: string }>,
  ) => void;
  complete: (options?: { skipped?: boolean }) => void;
  markWelcomeGreetingConsumed: () => void;
  reset: () => void;
}

const EMPTY_PROFILE: OnboardingProfile = Object.freeze({
  field: [],
  fieldOther: null,
  dataInterests: [],
  autoConnectedDatasets: [],
});

const STORAGE_KEY = "agentscience:onboarding:v1";

export const useOnboardingStore = create<OnboardingState>()(
  persist(
    (set) => ({
      completed: false,
      skipped: false,
      completedAt: null,
      welcomeGreetingConsumed: false,
      profile: EMPTY_PROFILE,

      setField: (field) => {
        const capped = field.slice(0, 2);
        set((state) => ({
          profile: { ...state.profile, field: capped },
        }));
      },
      setFieldOther: (text) => {
        const trimmed = text === null ? null : text.trim();
        set((state) => ({
          profile: { ...state.profile, fieldOther: trimmed === "" ? null : trimmed },
        }));
      },
      setDataInterests: (ids) => {
        const capped = ids.slice(0, 2);
        set((state) => ({
          profile: { ...state.profile, dataInterests: capped },
        }));
      },
      setAutoConnectedDatasets: (entries) => {
        set((state) => ({
          profile: { ...state.profile, autoConnectedDatasets: entries },
        }));
      },
      complete: (options) => {
        set(() => ({
          completed: true,
          skipped: options?.skipped ?? false,
          completedAt: new Date().toISOString(),
        }));
      },
      markWelcomeGreetingConsumed: () => {
        set(() => ({ welcomeGreetingConsumed: true }));
      },
      reset: () => {
        set(() => ({
          completed: false,
          skipped: false,
          completedAt: null,
          welcomeGreetingConsumed: false,
          profile: EMPTY_PROFILE,
        }));
      },
    }),
    {
      name: STORAGE_KEY,
      storage: createJSONStorage(() =>
        typeof localStorage !== "undefined"
          ? localStorage
          : {
              getItem: () => null,
              setItem: () => undefined,
              removeItem: () => undefined,
            },
      ),
      version: 1,
      partialize: (state) => ({
        completed: state.completed,
        skipped: state.skipped,
        completedAt: state.completedAt,
        welcomeGreetingConsumed: state.welcomeGreetingConsumed,
        profile: state.profile,
      }),
    },
  ),
);

/** Read the current profile outside of React. */
export function getOnboardingProfile(): OnboardingProfile {
  return useOnboardingStore.getState().profile;
}

/** True when onboarding has been seen (completed or explicitly skipped). */
export function getOnboardingSeen(): boolean {
  const state = useOnboardingStore.getState();
  return state.completed || state.skipped;
}
