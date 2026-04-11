import { projectScriptRuntimeEnv, setupProjectScript } from "@agentscience/shared/projectScripts";
import { Effect, Layer, Path } from "effect";

import { OrchestrationEngineService } from "../../orchestration/Services/OrchestrationEngine.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
import { TerminalManager } from "../../terminal/Services/Manager.ts";
import {
  type ProjectSetupScriptRunnerShape,
  ProjectSetupScriptRunner,
} from "../Services/ProjectSetupScriptRunner.ts";

const makeProjectSetupScriptRunner = Effect.gen(function* () {
  const orchestrationEngine = yield* OrchestrationEngineService;
  const path = yield* Path.Path;
  const serverSettingsService = yield* ServerSettingsService;
  const terminalManager = yield* TerminalManager;

  const resolveProjectPath = (workspaceRoot: string, folderSlug: string) =>
    path.join(workspaceRoot, "Projects", folderSlug);

  const runForThread: ProjectSetupScriptRunnerShape["runForThread"] = (input) =>
    Effect.gen(function* () {
      const readModel = yield* orchestrationEngine.getReadModel();
      const settings = yield* serverSettingsService.getSettings;
      const project =
        (input.projectId
          ? readModel.projects.find((entry) => entry.id === input.projectId)
          : null) ??
        (input.projectCwd
          ? readModel.projects.find(
              (entry) =>
                resolveProjectPath(settings.workspaceRoot, entry.folderSlug) === input.projectCwd,
            )
          : null) ??
        null;

      if (!project) {
        return yield* Effect.fail(new Error("Project was not found for setup script execution."));
      }

      const script = setupProjectScript(project.scripts);
      if (!script) {
        return {
          status: "no-script",
        } as const;
      }

      const terminalId = input.preferredTerminalId ?? `setup-${script.id}`;
      const cwd = input.worktreePath;
      const projectCwd =
        input.projectCwd ?? resolveProjectPath(settings.workspaceRoot, project.folderSlug);
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
