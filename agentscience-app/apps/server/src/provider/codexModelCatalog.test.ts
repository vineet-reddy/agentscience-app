import { describe, expect, it } from "vitest";

import {
  DEFAULT_CODEX_GPT_CAPABILITIES,
  fetchCodexModelCatalog,
  mergeCodexCatalogModels,
  modelsForCodexAccount,
  type CodexCatalogModel,
} from "./codexModelCatalog.ts";

const model = (
  slug: string,
  availableFor?: CodexCatalogModel["availableFor"],
  name = slug,
): CodexCatalogModel => ({
  slug,
  name,
  isCustom: false,
  capabilities: DEFAULT_CODEX_GPT_CAPABILITIES,
  ...(availableFor ? { availableFor } : {}),
});

describe("codex model catalog", () => {
  it("filters ChatGPT-only models out of API key accounts", () => {
    const models = [model("gpt-5.3-codex-spark", ["chatgpt"]), model("gpt-5.4")];

    expect(
      modelsForCodexAccount(models, {
        type: "apiKey",
        planType: null,
        sparkEnabled: false,
      }).map((entry) => entry.slug),
    ).toEqual(["gpt-5.4"]);

    expect(
      modelsForCodexAccount(models, {
        type: "chatgpt",
        planType: "plus",
        sparkEnabled: false,
      }).map((entry) => entry.slug),
    ).toEqual(["gpt-5.3-codex-spark", "gpt-5.4"]);
  });

  it("lets the remote catalog replace and prepend bundled models", () => {
    expect(
      mergeCodexCatalogModels(
        [model("gpt-5.4"), model("gpt-5.3-codex")],
        [model("gpt-5.4-mini"), model("gpt-5.4")],
      ).map((entry) => entry.slug),
    ).toEqual(["gpt-5.4-mini", "gpt-5.4", "gpt-5.3-codex"]);
  });

  it("parses the AgentScience app model catalog response", async () => {
    const fetchImpl = async () =>
      new Response(
        JSON.stringify({
          providers: {
            codex: {
              models: [
                {
                  slug: "gpt-5.3-codex-spark",
                  name: "GPT-5.3 Codex Spark",
                  availableFor: ["chatgpt"],
                  capabilities: DEFAULT_CODEX_GPT_CAPABILITIES,
                },
              ],
            },
          },
        }),
      );

    await expect(fetchCodexModelCatalog("https://agentscience.app", fetchImpl)).resolves.toEqual([
      model("gpt-5.3-codex-spark", ["chatgpt"], "GPT-5.3 Codex Spark"),
    ]);
  });
});
