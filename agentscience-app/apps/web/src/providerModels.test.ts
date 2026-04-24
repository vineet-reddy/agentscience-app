import type { ServerProvider, ServerProviderModel } from "@agentscience/contracts";
import { describe, expect, it } from "vitest";

import { getDefaultProviderModelOptions, getDefaultServerModel } from "./providerModels";

const model = (slug: string, extra?: Partial<ServerProviderModel>): ServerProviderModel => ({
  slug,
  name: slug,
  isCustom: false,
  capabilities: {
    reasoningEffortLevels: [
      { value: "xhigh", label: "Extra High" },
      { value: "high", label: "High" },
      { value: "medium", label: "Medium", isDefault: true },
      { value: "low", label: "Low" },
    ],
    supportsFastMode: true,
    supportsThinkingToggle: false,
    contextWindowOptions: [],
    promptInjectedEffortLevels: [],
  },
  ...extra,
});

const provider = (models: ServerProviderModel[]): ServerProvider => ({
  provider: "codex",
  enabled: true,
  installed: true,
  version: null,
  status: "ready",
  auth: { status: "authenticated" },
  checkedAt: "2026-04-23T12:00:00.000Z",
  models,
});

describe("provider model defaults", () => {
  it("uses the latest available GPT model instead of relying on list order", () => {
    expect(
      getDefaultServerModel(
        [provider([model("gpt-5.2"), model("gpt-5.4"), model("gpt-5.3-codex")])],
        "codex",
      ),
    ).toBe("gpt-5.4");
  });

  it("prefers the flagship model over variants for the same GPT version", () => {
    expect(
      getDefaultServerModel(
        [provider([model("gpt-5.4-mini"), model("gpt-5.4"), model("gpt-5.4-nano")])],
        "codex",
      ),
    ).toBe("gpt-5.4");
  });

  it("defaults supported reasoning models to medium effort and fast mode", () => {
    expect(getDefaultProviderModelOptions([model("gpt-5.4")], "codex", "gpt-5.4")).toEqual({
      reasoningEffort: "medium",
      fastMode: true,
    });
  });
});
