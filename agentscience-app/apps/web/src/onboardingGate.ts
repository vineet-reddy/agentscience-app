import type { AgentScienceAuthState } from "@agentscience/contracts";

export function resolveOnboardingAccountSyncKey(input: {
  readonly accountState: AgentScienceAuthState | null;
  readonly accountIsLoading: boolean;
}): string | null | undefined {
  if (input.accountIsLoading && input.accountState === null) {
    return undefined;
  }

  const agentScienceStatus = input.accountState?.status ?? "signed-out";
  const onboardingAccountKey =
    agentScienceStatus === "signed-in" ? (input.accountState?.user?.id ?? null) : null;

  if (agentScienceStatus === "signed-in" && onboardingAccountKey === null) {
    return undefined;
  }

  return onboardingAccountKey;
}
