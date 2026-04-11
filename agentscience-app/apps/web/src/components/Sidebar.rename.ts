import { type NativeApi, type OrchestrationReadModel } from "@agentscience/contracts";

export async function dispatchCommandAndSyncSnapshot(
  api: Pick<NativeApi, "orchestration">,
  command: Parameters<NativeApi["orchestration"]["dispatchCommand"]>[0],
  syncServerReadModel: (readModel: OrchestrationReadModel) => void,
): Promise<void> {
  await api.orchestration.dispatchCommand(command);

  try {
    const snapshot = await api.orchestration.getSnapshot();
    syncServerReadModel(snapshot);
  } catch {
    // The live event stream will still converge the client state if snapshot refresh fails.
  }
}
