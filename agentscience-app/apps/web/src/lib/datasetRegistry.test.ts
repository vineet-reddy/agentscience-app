import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchDatasetRegistry, resolveSourcePaperUrl } from "./datasetRegistry";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("datasetRegistry", () => {
  it("targets the desktop backend proxy when the desktop bridge is available", async () => {
    vi.stubGlobal("window", {
      desktopBridge: {
        getWsUrl: () => "ws://127.0.0.1:55566/?token=desktop-token",
      },
      location: {
        origin: "http://localhost:5734",
      },
    });

    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          datasets: [
            {
              id: "dataset-1",
              name: "Open Climate Archive",
              url: "https://data.example.org/archive",
              domain: "data.example.org",
              description: "Desktop registry proxy test payload.",
              keywords: ["climate", "archive"],
              sourcePaperId: "paper-1",
              sourceRank: 97,
              addedBy: "user-1",
              createdAt: "2026-04-17T12:00:00.000Z",
              sourcePaper: {
                slug: "climate-registry-paper",
                title: "Climate Registry Paper",
                authors: ["Researcher One", "Researcher Two"],
                publishedAt: "2026-04-16T12:00:00.000Z",
                url: "/papers/climate-registry-paper",
              },
              usedInPaperCount: 1,
            },
          ],
        }),
        { status: 200 },
      ),
    );

    const datasets = await fetchDatasetRegistry({ limit: 25 });

    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:55566/api/datasets/registry?limit=25",
      expect.objectContaining({
        method: "GET",
      }),
    );
    expect(datasets).toHaveLength(1);
    expect(datasets[0]?.sourcePaper?.title).toBe("Climate Registry Paper");
    expect(datasets[0]?.usedInPaperCount).toBe(1);
  });

  it("builds public source paper links against the AgentScience platform", () => {
    expect(resolveSourcePaperUrl({ slug: "climate-registry-paper" })).toBe(
      "https://agentscience.vercel.app/papers/climate-registry-paper",
    );
  });
});
