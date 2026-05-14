import { describe, expect, it } from "vitest";
import type { ProviderKind, ServerProvider, ServerProviderModel } from "@agentscience/contracts";

import {
  getProviderModels,
  hasProviderModelAccess,
  resolveSelectableProvider,
} from "./providerModels";

const model = (slug: string): ServerProviderModel => ({
  slug,
  name: slug,
  isCustom: false,
  capabilities: null,
});

const provider = (
  providerKind: ProviderKind,
  authStatus: ServerProvider["auth"]["status"],
  models: ReadonlyArray<ServerProviderModel>,
): ServerProvider => ({
  provider: providerKind,
  enabled: true,
  installed: true,
  version: null,
  status: "ready",
  auth: { status: authStatus },
  checkedAt: "2026-05-14T12:00:00.000Z",
  models: [...models],
});

describe("providerModels", () => {
  it("only exposes models for authenticated providers", () => {
    const providers = [
      provider("codex", "unauthenticated", [model("gpt-5.5")]),
      provider("gemini", "authenticated", [model("gemini-3.1-pro-preview")]),
    ];

    expect(getProviderModels(providers, "codex")).toEqual([]);
    expect(getProviderModels(providers, "gemini").map((entry) => entry.slug)).toEqual([
      "gemini-3.1-pro-preview",
    ]);
  });

  it("falls back to an authenticated provider when the requested provider is not connected", () => {
    const providers = [
      provider("codex", "unauthenticated", [model("gpt-5.5")]),
      provider("gemini", "authenticated", [model("gemini-3.1-pro-preview")]),
    ];

    expect(resolveSelectableProvider(providers, "codex")).toBe("gemini");
  });

  it("treats warning or unknown-auth providers as unavailable for model picking", () => {
    const gemini = provider("gemini", "unknown", [model("gemini-3.1-pro-preview")]);

    expect(hasProviderModelAccess(gemini)).toBe(false);
    expect(getProviderModels([gemini], "gemini")).toEqual([]);
  });
});
