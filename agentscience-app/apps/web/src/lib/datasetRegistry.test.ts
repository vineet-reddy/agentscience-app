import { afterEach, describe, expect, it, vi } from "vitest";

import {
  fetchDatasetRegistry,
  inspectDatasetRegistryCandidate,
  resolveSourcePaperUrl,
} from "./datasetRegistry";

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
      "https://agentscience.app/papers/climate-registry-paper",
    );
  });

  it("inspects dataset candidates through the desktop registry API and normalizes the real review payload", async () => {
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
          candidate: {
            name: "OpenNeuro ds003823",
            shortName: "ds003823",
            url: "https://openneuro.org/datasets/ds003823",
            description: "Dataset reference for ds003823 hosted by OpenNeuro.",
            keywords: ["openneuro", "ds003823"],
            providerSlug: "openneuro",
            topicSlugs: ["neuroimaging", "neuroscience"],
            registryEligible: true,
          },
          check: {
            status: "new",
            candidate: {
              name: "OpenNeuro ds003823",
              shortName: "ds003823",
              url: "https://openneuro.org/datasets/ds003823",
              domain: "openneuro.org",
              description: "Dataset reference for ds003823 hosted by OpenNeuro.",
              keywords: ["openneuro", "ds003823"],
              providerSlug: "openneuro",
              topicSlugs: ["neuroimaging", "neuroscience"],
              unknownTopicSlugs: [],
              registryEligible: true,
            },
            matches: [],
          },
          validation: {
            status: "UNCLEAR",
            summary:
              "The page did not provide enough concrete evidence to prove the dataset is openly usable.",
            finalUrl: "https://openneuro.org/datasets/ds003823",
            httpStatus: 200,
            directFileLinks: [],
            githubDataLinks: [],
            apiLinks: [],
            providerEvidence: [],
            license: null,
            licenseStatus: "unknown",
            notes: [],
          },
          validationLines: ["Validation status: UNCLEAR"],
          standalonePolicy: {
            ok: false,
            mode: "standalone",
            errors: [
              "Dataset URL does not match provider 'openneuro' URL template 'https://openneuro.org/datasets/{datasetId}/versions/{version}'. Use a canonical dataset page URL, not an ad hoc export or query result.",
            ],
            identifiers: null,
          },
          standalonePolicyLines: ["Standalone policy: FAIL"],
          provider: {
            id: "provider-openneuro",
            slug: "openneuro",
            name: "OpenNeuro",
            homeUrl: "https://openneuro.org",
            domain: "openneuro.org",
            description: "Open neuroimaging datasets.",
            logoUrl: null,
            searchKind: "REST",
            searchEndpoint: "https://openneuro.org/crn/datasets",
            searchQueryTemplate: "{query}",
            datasetUrlTemplate: "https://openneuro.org/datasets/{datasetId}/versions/{version}",
            agentInstructions: "Use canonical versioned dataset URLs.",
            datasetCount: 0,
            createdAt: "2026-05-06T00:00:00.000Z",
            topics: [
              {
                id: "topic-neuroimaging",
                slug: "neuroimaging",
                name: "Neuroimaging",
                area: "MEDICINE_HEALTH",
              },
            ],
          },
          hydratedFrom: "url",
        }),
        { status: 200 },
      ),
    );

    const result = await inspectDatasetRegistryCandidate({
      url: "https://openneuro.org/datasets/ds003823",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:55566/api/datasets/registry/inspect",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ url: "https://openneuro.org/datasets/ds003823" }),
      }),
    );
    expect(result.candidate.name).toBe("OpenNeuro ds003823");
    expect(result.candidate.description).toBe(
      "Dataset reference for ds003823 hosted by OpenNeuro.",
    );
    expect(result.candidate.name).not.toContain("Dataset from");
    expect(result.candidate.description).not.toContain("Agent-detected");
    expect(result.check?.status).toBe("new");
    expect(result.validation?.status).toBe("UNCLEAR");
    expect(result.standalonePolicy?.ok).toBe(false);
    expect(result.standalonePolicy?.errors[0]).toContain("canonical dataset page URL");
    expect(result.provider?.slug).toBe("openneuro");
  });
});
