import { describe, expect, it } from "vitest";

import {
  resolveDefaultDesktopCodexHomePath,
  resolveDesktopServerSettingsPath,
  resolveDesktopStateDir,
} from "./statePaths";

describe("desktop state paths", () => {
  it("uses the dev state directory during desktop development", () => {
    expect(resolveDesktopStateDir("/Users/test/.agentscience", true)).toBe(
      "/Users/test/.agentscience/dev",
    );
    expect(resolveDesktopServerSettingsPath("/Users/test/.agentscience", true)).toBe(
      "/Users/test/.agentscience/dev/settings.json",
    );
    expect(resolveDefaultDesktopCodexHomePath("/Users/test/.agentscience", true)).toBe(
      "/Users/test/.agentscience/dev/codex",
    );
  });

  it("uses the userdata state directory for packaged desktop builds", () => {
    expect(resolveDesktopStateDir("/Users/test/.agentscience", false)).toBe(
      "/Users/test/.agentscience/userdata",
    );
    expect(resolveDesktopServerSettingsPath("/Users/test/.agentscience", false)).toBe(
      "/Users/test/.agentscience/userdata/settings.json",
    );
    expect(resolveDefaultDesktopCodexHomePath("/Users/test/.agentscience", false)).toBe(
      "/Users/test/.agentscience/userdata/codex",
    );
  });
});
