import type { ServerRuntimeAgentScience } from "@agentscience/contracts";

export interface AgentScienceRuntimeStatusDescriptor {
  readonly settingsTitle: string;
  readonly settingsDescription: string;
  readonly noticeTitle: string | null;
  readonly noticeDescription: string | null;
}

export function describeAgentScienceRuntimeStatus(
  status: ServerRuntimeAgentScience | null | undefined,
): AgentScienceRuntimeStatusDescriptor {
  if (!status || status.state === "checking") {
    return {
      settingsTitle: "Checking on launch",
      settingsDescription: "AgentScience is checking the managed tools in this app.",
      noticeTitle: null,
      noticeDescription: null,
    };
  }

  if (status.state === "unavailable") {
    return {
      settingsTitle: "Runtime check unavailable",
      settingsDescription:
        status.message ?? "AgentScience could not run the startup runtime check on this system.",
      noticeTitle: null,
      noticeDescription: null,
    };
  }

  if (status.state === "error") {
    return {
      settingsTitle: "Runtime check failed",
      settingsDescription:
        status.message ?? "AgentScience could not complete the startup runtime check.",
      noticeTitle: null,
      noticeDescription: null,
    };
  }

  if (status.refreshRecommended && status.updateAvailable) {
    return {
      settingsTitle: "Update ready",
      settingsDescription: "A managed-tools update is ready and setup will be refreshed too.",
      noticeTitle: "Managed tools update ready",
      noticeDescription: "Open Settings to update the managed tools.",
    };
  }

  if (status.refreshRecommended) {
    return {
      settingsTitle: "Refresh needed",
      settingsDescription: "The managed tools need a quick refresh in this app.",
      noticeTitle: "Managed tools need a refresh",
      noticeDescription: "Open Settings to refresh the managed tools.",
    };
  }

  if (status.updateAvailable) {
    return {
      settingsTitle: "Update ready",
      settingsDescription: "A managed-tools update is ready in this app.",
      noticeTitle: "Managed tools update ready",
      noticeDescription: "Open Settings to update the managed tools.",
    };
  }

  return {
    settingsTitle: "Up to date",
    settingsDescription: "The managed tools bundled with this app are up to date.",
    noticeTitle: null,
    noticeDescription: null,
  };
}

export function shouldShowAgentScienceRuntimeNotice(
  status: ServerRuntimeAgentScience | null | undefined,
): boolean {
  return Boolean(
    status && status.state === "ready" && (status.updateAvailable || status.refreshRecommended),
  );
}
