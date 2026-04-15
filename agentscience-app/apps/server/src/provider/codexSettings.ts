import { join } from "node:path";

import type { CodexSettings } from "@agentscience/contracts";

import type { ServerConfigShape } from "../config";
import { resolveCodexBinaryPath } from "./codexCli";

type CodexSettingsConfig = Pick<ServerConfigShape, "mode" | "stateDir">;

export function resolveDefaultCodexHomePath(
  config: Pick<CodexSettingsConfig, "stateDir">,
): string {
  return join(config.stateDir, "codex");
}

export function resolveCodexHomePath(
  settings: Pick<CodexSettings, "homePath">,
  config: CodexSettingsConfig,
): string {
  const explicitHomePath = settings.homePath.trim();
  if (explicitHomePath.length > 0) {
    return explicitHomePath;
  }

  if (config.mode === "desktop") {
    return resolveDefaultCodexHomePath(config);
  }

  return "";
}

export function resolveEffectiveCodexSettings(
  settings: CodexSettings,
  config: CodexSettingsConfig,
): CodexSettings {
  return {
    ...settings,
    binaryPath: resolveCodexBinaryPath(settings),
    homePath: resolveCodexHomePath(settings, config),
  };
}
