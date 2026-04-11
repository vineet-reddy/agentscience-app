import {
  CommandId,
  ProjectId,
  type OrchestrationReadModel,
} from "@agentscience/contracts";
import { describe, expect, it, vi } from "vitest";

import { dispatchCommandAndSyncSnapshot } from "./Sidebar.rename";

describe("dispatchCommandAndSyncSnapshot", () => {
  it("refreshes the client store from the authoritative snapshot after a successful command", async () => {
    const snapshot: OrchestrationReadModel = {
      snapshotSequence: 7,
      updatedAt: "2026-04-11T08:00:00.000Z",
      projects: [],
      threads: [],
    };
    const api = {
      orchestration: {
        dispatchCommand: vi.fn().mockResolvedValue({ sequence: 7 }),
        getSnapshot: vi.fn().mockResolvedValue(snapshot),
      },
    };
    const syncServerReadModel = vi.fn();
    const command = {
      type: "project.meta.update" as const,
      commandId: CommandId.makeUnsafe("cmd-1"),
      projectId: ProjectId.makeUnsafe("project-1"),
      title: "Renamed Project",
    };

    await dispatchCommandAndSyncSnapshot(
      api as never,
      command,
      syncServerReadModel,
    );

    expect(api.orchestration.dispatchCommand).toHaveBeenCalledWith(command);
    expect(api.orchestration.getSnapshot).toHaveBeenCalledOnce();
    expect(syncServerReadModel).toHaveBeenCalledWith(snapshot);
  });

  it("does not fail the command flow when the follow-up snapshot refresh errors", async () => {
    const api = {
      orchestration: {
        dispatchCommand: vi.fn().mockResolvedValue({ sequence: 7 }),
        getSnapshot: vi.fn().mockRejectedValue(new Error("snapshot failed")),
      },
    };
    const syncServerReadModel = vi.fn();

    await expect(
      dispatchCommandAndSyncSnapshot(
        api as never,
        {
          type: "project.meta.update",
          commandId: CommandId.makeUnsafe("cmd-1"),
          projectId: ProjectId.makeUnsafe("project-1"),
          title: "Renamed Project",
        },
        syncServerReadModel,
      ),
    ).resolves.toBeUndefined();

    expect(api.orchestration.dispatchCommand).toHaveBeenCalledOnce();
    expect(api.orchestration.getSnapshot).toHaveBeenCalledOnce();
    expect(syncServerReadModel).not.toHaveBeenCalled();
  });
});
