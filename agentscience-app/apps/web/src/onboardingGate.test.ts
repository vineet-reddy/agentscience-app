import type { AgentScienceAuthState } from "@agentscience/contracts";
import { describe, expect, it } from "vitest";

import { resolveOnboardingAccountSyncKey } from "./onboardingGate";

const signedOutState = {
  status: "signed-out",
  updatedAt: "2026-04-30T12:00:00.000Z",
  baseUrl: "https://agentscience.test",
} satisfies AgentScienceAuthState;

const signedInState = {
  status: "signed-in",
  updatedAt: "2026-04-30T12:00:00.000Z",
  baseUrl: "https://agentscience.test",
  user: {
    id: "user-1",
    name: "Test User",
    handle: "test-user",
    email: null,
    institution: null,
    publicationProfileComplete: true,
    publishNameRequired: false,
  },
} satisfies AgentScienceAuthState;

describe("resolveOnboardingAccountSyncKey", () => {
  it("does not clear persisted onboarding while account state is still loading", () => {
    expect(
      resolveOnboardingAccountSyncKey({
        accountState: null,
        accountIsLoading: true,
      }),
    ).toBeUndefined();
  });

  it("clears onboarding on a confirmed signed-out state", () => {
    expect(
      resolveOnboardingAccountSyncKey({
        accountState: signedOutState,
        accountIsLoading: false,
      }),
    ).toBeNull();
  });

  it("syncs onboarding to the signed-in account id", () => {
    expect(
      resolveOnboardingAccountSyncKey({
        accountState: signedInState,
        accountIsLoading: false,
      }),
    ).toBe("user-1");
  });
});
