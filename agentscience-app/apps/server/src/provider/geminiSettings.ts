import type { GeminiSettings } from "@agentscience/contracts";

export interface EffectiveGeminiSettings {
  readonly enabled: boolean;
  readonly binaryPath: string;
  readonly customModels: ReadonlyArray<string>;
  readonly authMethod: GeminiSettings["authMethod"];
}

export function resolveEffectiveGeminiSettings(settings: GeminiSettings): EffectiveGeminiSettings {
  const binaryPath = settings.binaryPath.trim() || "gemini";
  return {
    enabled: settings.enabled,
    binaryPath,
    customModels: settings.customModels,
    authMethod: settings.authMethod,
  };
}
