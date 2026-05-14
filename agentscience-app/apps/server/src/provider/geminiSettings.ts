import type { GeminiSettings } from "@agentscience/contracts";

import { resolveGeminiBinaryPath } from "./geminiCli";

export interface EffectiveGeminiSettings {
  readonly enabled: boolean;
  readonly binaryPath: string;
  readonly customModels: ReadonlyArray<string>;
  readonly authMethod: GeminiSettings["authMethod"];
}

export function resolveEffectiveGeminiSettings(settings: GeminiSettings): EffectiveGeminiSettings {
  return {
    enabled: settings.enabled,
    binaryPath: resolveGeminiBinaryPath(settings),
    customModels: settings.customModels,
    authMethod: settings.authMethod,
  };
}
