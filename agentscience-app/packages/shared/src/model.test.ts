import { describe, expect, it } from "vitest";
import { DEFAULT_MODEL_BY_PROVIDER, type ModelCapabilities } from "@agentscience/contracts";

import {
  getDefaultContextWindow,
  getDefaultEffort,
  hasContextWindowOption,
  hasEffortLevel,
  normalizeCodexModelOptionsWithCapabilities,
  normalizeModelSlug,
  resolveApiModelId,
  resolveContextWindow,
  resolveEffort,
  resolveModelSlug,
  resolveSelectableModel,
  trimOrNull,
} from "./model";

const codexCaps: ModelCapabilities = {
  reasoningEffortLevels: [
    { value: "xhigh", label: "Extra High" },
    { value: "high", label: "High", isDefault: true },
  ],
  supportsFastMode: true,
  supportsThinkingToggle: false,
  contextWindowOptions: [],
  promptInjectedEffortLevels: [],
};

describe("normalizeModelSlug", () => {
  it("maps known aliases to canonical slugs", () => {
    expect(normalizeModelSlug("5.5")).toBe("gpt-5.5");
    expect(normalizeModelSlug("5.3")).toBe("gpt-5.3-codex");
  });

  it("maps Gemini aliases to the current Gemini 3 family", () => {
    expect(normalizeModelSlug("3.1", "gemini")).toBe("gemini-3.1-pro-preview");
    expect(normalizeModelSlug("flash", "gemini")).toBe("gemini-3-flash-preview");
    expect(normalizeModelSlug("flash-lite", "gemini")).toBe("gemini-3.1-flash-lite");
  });

  it("returns null for empty or missing values", () => {
    expect(normalizeModelSlug("")).toBeNull();
    expect(normalizeModelSlug("   ")).toBeNull();
    expect(normalizeModelSlug(null)).toBeNull();
    expect(normalizeModelSlug(undefined)).toBeNull();
  });
});

describe("resolveModelSlug", () => {
  it("returns defaults when the model is missing", () => {
    expect(resolveModelSlug(undefined, "codex")).toBe(DEFAULT_MODEL_BY_PROVIDER.codex);
    expect(resolveModelSlug(undefined, "gemini")).toBe(DEFAULT_MODEL_BY_PROVIDER.gemini);
  });

  it("preserves normalized unknown models", () => {
    expect(resolveModelSlug("custom/internal-model", "codex")).toBe("custom/internal-model");
  });
});

describe("resolveSelectableModel", () => {
  it("resolves exact slugs, labels, and aliases", () => {
    const options = [{ slug: "gpt-5.3-codex", name: "GPT-5.3 Codex" }];
    expect(resolveSelectableModel("codex", "gpt-5.3-codex", options)).toBe("gpt-5.3-codex");
    expect(resolveSelectableModel("codex", "gpt-5.3 codex", options)).toBe("gpt-5.3-codex");
  });

  it("resolves Gemini aliases against Gemini options", () => {
    const options = [{ slug: "gemini-3.1-pro-preview", name: "Gemini 3.1 Pro Preview" }];
    expect(resolveSelectableModel("gemini", "3.1-pro", options)).toBe("gemini-3.1-pro-preview");
  });
});

describe("capability helpers", () => {
  it("reads default efforts", () => {
    expect(getDefaultEffort(codexCaps)).toBe("high");
  });

  it("checks effort support", () => {
    expect(hasEffortLevel(codexCaps, "xhigh")).toBe(true);
    expect(hasEffortLevel(codexCaps, "max")).toBe(false);
  });
});

describe("resolveEffort", () => {
  it("returns the explicit value when supported and not prompt-injected", () => {
    expect(resolveEffort(codexCaps, "xhigh")).toBe("xhigh");
    expect(resolveEffort(codexCaps, "high")).toBe("high");
  });

  it("falls back to default when value is unsupported", () => {
    expect(resolveEffort(codexCaps, "bogus")).toBe("high");
  });

  it("returns the default when no value is provided", () => {
    expect(resolveEffort(codexCaps, undefined)).toBe("high");
    expect(resolveEffort(codexCaps, null)).toBe("high");
    expect(resolveEffort(codexCaps, "")).toBe("high");
    expect(resolveEffort(codexCaps, "  ")).toBe("high");
  });
  it("returns undefined for models with no effort levels", () => {
    const noCaps: ModelCapabilities = {
      reasoningEffortLevels: [],
      supportsFastMode: false,
      supportsThinkingToggle: false,
      contextWindowOptions: [],
      promptInjectedEffortLevels: [],
    };
    expect(resolveEffort(noCaps, undefined)).toBeUndefined();
    expect(resolveEffort(noCaps, "high")).toBeUndefined();
  });
});

describe("misc helpers", () => {
  it("trims strings to null", () => {
    expect(trimOrNull("  hi  ")).toBe("hi");
    expect(trimOrNull("   ")).toBeNull();
  });
});

describe("context window helpers", () => {
  it("returns null for models without context window options", () => {
    expect(getDefaultContextWindow(codexCaps)).toBeNull();
  });

  it("checks context window support", () => {
    expect(hasContextWindowOption(codexCaps, "1m")).toBe(false);
  });
});

describe("resolveContextWindow", () => {
  it("returns undefined for models with no context window options", () => {
    expect(resolveContextWindow(codexCaps, undefined)).toBeUndefined();
    expect(resolveContextWindow(codexCaps, "1m")).toBeUndefined();
  });
});

describe("resolveApiModelId", () => {
  it("returns the model as-is for Codex selections", () => {
    expect(resolveApiModelId({ provider: "codex", model: "gpt-5.4" })).toBe("gpt-5.4");
  });

  it("returns the model as-is for Gemini selections", () => {
    expect(resolveApiModelId({ provider: "gemini", model: "gemini-3.1-pro-preview" })).toBe(
      "gemini-3.1-pro-preview",
    );
  });
});

describe("normalize*ModelOptionsWithCapabilities", () => {
  it("defaults codex fast mode on when the model supports it", () => {
    expect(normalizeCodexModelOptionsWithCapabilities(codexCaps, undefined)).toEqual({
      reasoningEffort: "high",
      fastMode: true,
    });
  });

  it("preserves explicit false codex fast mode", () => {
    expect(
      normalizeCodexModelOptionsWithCapabilities(codexCaps, {
        reasoningEffort: "high",
        fastMode: false,
      }),
    ).toEqual({
      reasoningEffort: "high",
      fastMode: false,
    });
  });
});
