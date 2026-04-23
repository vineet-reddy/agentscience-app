import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { useOnboardingStore } from "./onboardingStore";

describe("onboardingStore account scoping", () => {
  beforeEach(() => {
    useOnboardingStore.getState().syncAccount(null);
  });

  afterEach(() => {
    useOnboardingStore.getState().syncAccount(null);
  });

  it("preserves onboarding state for the same account", () => {
    const store = useOnboardingStore.getState();

    store.syncAccount("user-1");
    store.setField(["oncology"]);
    store.setDataInterests(["depmap"]);
    store.complete();
    store.markWelcomeGreetingConsumed();
    store.syncAccount("user-1");

    const state = useOnboardingStore.getState();
    expect(state.accountKey).toBe("user-1");
    expect(state.completed).toBe(true);
    expect(state.welcomeGreetingConsumed).toBe(true);
    expect(state.profile.field).toEqual(["oncology"]);
    expect(state.profile.dataInterests).toEqual(["depmap"]);
  });

  it("resets onboarding state when the signed-in account changes", () => {
    const store = useOnboardingStore.getState();

    store.syncAccount("user-1");
    store.setField(["oncology"]);
    store.setDataInterests(["depmap"]);
    store.complete();
    store.markWelcomeGreetingConsumed();
    store.syncAccount("user-2");

    const state = useOnboardingStore.getState();
    expect(state.accountKey).toBe("user-2");
    expect(state.completed).toBe(false);
    expect(state.skipped).toBe(false);
    expect(state.welcomeGreetingConsumed).toBe(false);
    expect(state.profile.field).toEqual([]);
    expect(state.profile.dataInterests).toEqual([]);
  });

  it("clears onboarding state on sign-out", () => {
    const store = useOnboardingStore.getState();

    store.syncAccount("user-1");
    store.setField(["oncology"]);
    store.complete();
    store.syncAccount(null);

    const state = useOnboardingStore.getState();
    expect(state.accountKey).toBeNull();
    expect(state.completed).toBe(false);
    expect(state.profile.field).toEqual([]);
  });
});
