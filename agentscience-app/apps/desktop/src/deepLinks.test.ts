import { describe, expect, it } from "vitest";

import { extractAgentScienceDeepLinkUrls, parseAgentScienceDeepLink } from "./deepLinks";

describe("parseAgentScienceDeepLink", () => {
  it("parses a valid paper open link with a localhost base origin", () => {
    expect(
      parseAgentScienceDeepLink(
        "agentscience://paper/open?slug=test-paper&baseUrl=http%3A%2F%2Flocalhost%3A3000",
      ),
    ).toEqual({
      ok: true,
      deepLink: {
        type: "paper-open",
        slug: "test-paper",
        baseUrl: "http://localhost:3000",
      },
    });
  });

  it("accepts the production AgentScience origin", () => {
    expect(
      parseAgentScienceDeepLink(
        "agentscience://paper/open?slug=published-paper&baseUrl=https%3A%2F%2Fagentscience.app",
      ),
    ).toEqual({
      ok: true,
      deepLink: {
        type: "paper-open",
        slug: "published-paper",
        baseUrl: "https://agentscience.app",
      },
    });
  });

  it("allows baseUrl to be omitted", () => {
    expect(parseAgentScienceDeepLink("agentscience://paper/open?slug=test-paper")).toEqual({
      ok: true,
      deepLink: {
        type: "paper-open",
        slug: "test-paper",
      },
    });
  });

  it.each([
    ["https://agentscience.app/papers/x", "invalid-protocol"],
    ["agentscience://paper/other?slug=test-paper", "unsupported-action"],
    ["agentscience://settings/open?slug=test-paper", "unsupported-action"],
    ["agentscience://paper/open", "invalid-slug"],
    ["agentscience://paper/open?slug=../test", "invalid-slug"],
    ["agentscience://paper/open?slug=Test-Paper", "invalid-slug"],
    ["agentscience://paper/open?slug=test-paper&baseUrl=file%3A%2F%2F%2Ftmp%2Fx", "invalid-base-url"],
    [
      "agentscience://paper/open?slug=test-paper&baseUrl=https%3A%2F%2Fagentscience.app%2Fpapers",
      "invalid-base-url",
    ],
  ])("rejects %s", (url, reason) => {
    expect(parseAgentScienceDeepLink(url)).toEqual({ ok: false, reason });
  });
});

describe("extractAgentScienceDeepLinkUrls", () => {
  it("extracts custom protocol URLs from process arguments", () => {
    expect(
      extractAgentScienceDeepLinkUrls([
        "/Applications/AgentScience.app/Contents/MacOS/AgentScience",
        "--flag",
        "agentscience://paper/open?slug=test-paper",
      ]),
    ).toEqual(["agentscience://paper/open?slug=test-paper"]);
  });
});
