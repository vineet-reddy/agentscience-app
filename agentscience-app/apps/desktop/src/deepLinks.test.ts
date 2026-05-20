import { describe, expect, it } from "vitest";

import { collectAgentScienceDeepLinkUrls, parseAgentScienceDeepLink } from "./deepLinks";

describe("parseAgentScienceDeepLink", () => {
  it("parses paper open links", () => {
    expect(
      parseAgentScienceDeepLink(
        "agentscience://paper/open?slug=my-paper-slug&baseUrl=http%3A%2F%2Flocalhost%3A3000",
      ),
    ).toEqual({
      kind: "paper-open",
      slug: "my-paper-slug",
      baseUrl: "http://localhost:3000",
    });
  });

  it("rejects wrong schemes", () => {
    expect(
      parseAgentScienceDeepLink(
        "https://paper/open?slug=my-paper-slug&baseUrl=https%3A%2F%2Fagentscience.app",
      ),
    ).toBeNull();
  });

  it("rejects wrong routes", () => {
    expect(
      parseAgentScienceDeepLink(
        "agentscience://papers/open?slug=my-paper-slug&baseUrl=https%3A%2F%2Fagentscience.app",
      ),
    ).toBeNull();
    expect(
      parseAgentScienceDeepLink(
        "agentscience://paper/edit?slug=my-paper-slug&baseUrl=https%3A%2F%2Fagentscience.app",
      ),
    ).toBeNull();
  });

  it("rejects missing slug", () => {
    expect(
      parseAgentScienceDeepLink("agentscience://paper/open?baseUrl=https%3A%2F%2Fagentscience.app"),
    ).toBeNull();
  });

  it("rejects non-http base URLs", () => {
    expect(
      parseAgentScienceDeepLink(
        "agentscience://paper/open?slug=my-paper-slug&baseUrl=file%3A%2F%2F%2Ftmp%2Fpaper",
      ),
    ).toBeNull();
  });
});

describe("collectAgentScienceDeepLinkUrls", () => {
  it("collects valid agentscience URLs from argv", () => {
    expect(
      collectAgentScienceDeepLinkUrls([
        "--flag",
        "agentscience://paper/open?slug=my-paper-slug&baseUrl=https%3A%2F%2Fagentscience.app",
      ]),
    ).toEqual([
      "agentscience://paper/open?slug=my-paper-slug&baseUrl=https%3A%2F%2Fagentscience.app",
    ]);
  });
});
