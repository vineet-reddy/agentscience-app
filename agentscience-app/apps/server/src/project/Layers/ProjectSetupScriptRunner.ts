import { projectScriptRuntimeEnv, setupProjectScript } from "@agentscience/shared/projectScripts";
import { Effect, Layer, Option } from "effect";

import { OrchestrationEngineService } from "../../orchestration/Services/OrchestrationEngine.ts";
import { DeviceStateRepository } from "../../persistence/Services/DeviceState.ts";
import { TerminalManager } from "../../terminal/Services/Manager.ts";
import { normalizeWorkspacePath } from "../../workspace/roots.ts";
import {
  type ProjectSetupScriptRunnerShape,
  ProjectSetupScriptRunner,
} from "../Services/ProjectSetupScriptRunner.ts";

const PROJECT_METADATA_PREFIX = "local.project.";

function projectMetadataKey(projectId: string): string {
  return `${PROJECT_METADATA_PREFIX}${projectId}`;
}

function parseStoredProjectWorkspaceRoot(valueJson: string): string | null {
  try {
    const parsed = JSON.parse(valueJson) as { workspaceRoot?: unknown };
    return typeof parsed.workspaceRoot === "string" ? normalizeWorkspacePath(parsed.workspaceRoot) : null;
  } catch {
    return null;
  }
}

const makeProjectSetupScriptRunner = Effect.gen(function* () {
  const orchestrationEngine = yield* OrchestrationEngineService;
  const deviceStateRepository = yield* DeviceStateRepository;
  const terminalManager = yield* TerminalManager;

  const getProjectWorkspaceRoot = Effect.fn("ProjectSetupScriptRunner.getProjectWorkspaceRoot")(
    function* (projectId: string) {
      const metadataRow = yield* deviceStateRepository.getByKey({
        key: projectMetadataKey(projectId),
      });
      if (Option.isNone(metadataRow)) {
        return null;
      }
      return parseStoredProjectWorkspaceRoot(metadataRow.value.valueJson);
    },
  );

  const runForThread: ProjectSetupScriptRunnerShape["runForThread"] = (input) =>
    Effect.gen(function* () {
      const readModel = yield* orchestrationEngine.getReadModel();
      const thread = readModel.threads.find((entry) => entry.id === input.threadId) ?? null;
      const requestedProjectCwd =
        input.projectCwd === undefined ? null : normalizeWorkspacePath(input.projectCwd);
      let projectIdFromWorkspaceRoot: string | null = null;
      if (requestedProjectCwd !== null) {
        for (const entry of readModel.projects) {
          const workspaceRoot = yield* getProjectWorkspaceRoot(entry.id);
          if (workspaceRoot === requestedProjectCwd) {
            projectIdFromWorkspaceRoot = entry.id;
            break;
          }
        }
      }
      const targetProjectId =
        input.projectId ??
        thread?.projectId ??
        projectIdFromWorkspaceRoot;
      const project =
        targetProjectId === null
          ? null
          : (readModel.projects.find((entry) => entry.id === targetProjectId) ?? null);

      if (!project) {
        return yield* Effect.fail(new Error("Project was not found for setup script execution."));
      }

      const boundProjectCwd = yield* getProjectWorkspaceRoot(project.id);
      if (requestedProjectCwd !== null && boundProjectCwd !== null && requestedProjectCwd !== boundProjectCwd) {
        return yield* Effect.fail(
          new Error(
            `Project setup script cwd '${requestedProjectCwd}' does not match bound project workspace '${boundProjectCwd}'.`,
          ),
        );
      }

      const script = setupProjectScript(project.scripts);
      if (!script) {
        return {
          status: "no-script",
        } as const;
      }

      const terminalId = input.preferredTerminalId ?? `setup-${script.id}`;
      const cwd = input.worktreePath;
      const projectCwd = requestedProjectCwd ?? boundProjectCwd;
      if (projectCwd === null) {
        return yield* Effect.fail(
          new Error(`Project '${project.id}' does not have a bound workspace root.`),
        );
      }
      const env = projectScriptRuntimeEnv({
        project: { cwd: projectCwd },
        worktreePath: input.worktreePath,
      });

      yield* terminalManager.open({
        threadId: input.threadId,
        terminalId,
        cwd,
        worktreePath: input.worktreePath,
        env,
      });
      yield* terminalManager.write({
        threadId: input.threadId,
        terminalId,
        data: `${script.command}\r`,
      });

      return {
        status: "started",
        scriptId: script.id,
        scriptName: script.name,
        terminalId,
        cwd,
      } as const;
    });

  return {
    runForThread,
  } satisfies ProjectSetupScriptRunnerShape;
});

export const ProjectSetupScriptRunnerLive = Layer.effect(
  ProjectSetupScriptRunner,
  makeProjectSetupScriptRunner,
);
