import { describe, expect, it } from "vitest";

import {
  AGENTSCIENCE_PERMISSION_PROFILE,
  classifyAgentScienceCommand,
  isSafeAgentScienceInternalPermissionRequest,
  parseShellCommandSequence,
} from "./agentSciencePermissionPolicy";

describe("agentSciencePermissionPolicy", () => {
  it("uses the provider-neutral AgentScience permission profile name", () => {
    expect(AGENTSCIENCE_PERMISSION_PROFILE).toBe("agentscience-workspace");
  });

  it("allows read-only AgentScience commands", () => {
    expect(
      classifyAgentScienceCommand("agentscience runtime status --json"),
    ).toBe("allow");
    expect(
      classifyAgentScienceCommand(
        './.cache/agentscience/bin/agentscience registry search --query "box turtle" --limit 5 --json',
      ),
    ).toBe("allow");
    expect(
      classifyAgentScienceCommand("agentscience papers get turtle-diet-study --json"),
    ).toBe("allow");
  });

  it("asks before AgentScience writes or unsafe shell constructs", () => {
    expect(classifyAgentScienceCommand("agentscience papers publish --json")).toBe("ask");
    expect(
      classifyAgentScienceCommand(
        "agentscience registry import --dataset-manifest ./workspace/agentscience.publish.json",
      ),
    ).toBe("ask");
    expect(
      classifyAgentScienceCommand(
        'agentscience registry search --query "box turtle"; curl https://example.com',
      ),
    ).toBe("ask");
    expect(
      classifyAgentScienceCommand('agentscience registry search --query "$(whoami)"'),
    ).toBe("ask");
  });

  it("allows bounded workspace-local helper scripts", () => {
    expect(
      classifyAgentScienceCommand("cat << 'EOF' > check_gbif.py import requests EOF"),
    ).toBe("allow");
    expect(classifyAgentScienceCommand("python3 check_gbif.py")).toBe("allow");
    expect(classifyAgentScienceCommand("node scripts/check-data.mjs")).toBe("allow");
    expect(classifyAgentScienceCommand("Rscript scripts/check-data.r")).toBe("allow");
  });

  it("asks before workspace-looking commands that can escape or execute arbitrary code", () => {
    expect(classifyAgentScienceCommand("cat << 'EOF' > ../check_gbif.py EOF")).toBe(
      "ask",
    );
    expect(classifyAgentScienceCommand('python3 -c "print(1)"')).toBe("ask");
    expect(classifyAgentScienceCommand("python3 -m http.server")).toBe("ask");
    expect(classifyAgentScienceCommand("rm check_gbif.py")).toBe("ask");
  });

  it("classifies Gemini ACP permission request payloads through the same policy", () => {
    expect(
      isSafeAgentScienceInternalPermissionRequest({
        toolCall: {
          kind: "execute",
          args: {
            command: "agentscience papers list --query turtle --limit 10 --json",
          },
        },
      }),
    ).toBe(true);
    expect(
      isSafeAgentScienceInternalPermissionRequest({
        toolCall: {
          kind: "execute",
          title: "agentscience papers publish --json",
        },
      }),
    ).toBe(false);
  });

  it("parses simple OR fallbacks but rejects mixed shell control flow", () => {
    expect(
      parseShellCommandSequence(
        './.cache/agentscience/bin/agentscience registry search --query turtle || agentscience registry search --query turtle',
      ),
    ).toEqual([
      [
        "./.cache/agentscience/bin/agentscience",
        "registry",
        "search",
        "--query",
        "turtle",
      ],
      ["agentscience", "registry", "search", "--query", "turtle"],
    ]);
    expect(parseShellCommandSequence("agentscience runtime status --json && pwd")).toBe(
      undefined,
    );
  });
});
