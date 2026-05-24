import { describe, expect, it } from "vitest";

import { AGENT_CONFIGS, AGENT_CONFIG_BY_MODE } from "./agentRegistry";

describe("agent registry", () => {
  it("defines the four specialist agents in one registry", () => {
    expect(AGENT_CONFIGS.map((agent) => agent.id)).toEqual([
      "literature-review",
      "experimental-design",
      "data-analysis",
      "grant-writing",
    ]);
    expect(AGENT_CONFIGS.map((agent) => AGENT_CONFIG_BY_MODE[agent.id]?.name)).toEqual(
      AGENT_CONFIGS.map((agent) => agent.name),
    );
  });

  it("distinguishes agents by glyph and copy, not per-agent color", () => {
    for (const agent of AGENT_CONFIGS) {
      expect("color" in agent).toBe(false);
      expect(agent.icon).toBeTypeOf("object");
      expect(agent.name.length).toBeGreaterThan(0);
      expect(agent.chooserDesc.length).toBeGreaterThan(0);
    }
  });
});
