import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import { Effect, Layer } from "effect";

import { AgentScienceAuthService } from "./agentScienceAuth.ts";
import { ServerConfig } from "./config.ts";
import { makeLocalPapersService, __internal } from "./localPapers.ts";
import { OrchestrationEngineService } from "./orchestration/Services/OrchestrationEngine.ts";
import { ServerSettingsService } from "./serverSettings.ts";

async function makeTempWorkspaceRoot(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "agentscience-local-paper-publish-"));
}

async function writePaperWorkspace(input: {
  readonly workspaceRoot: string;
  readonly title?: string;
  readonly abstract?: string;
}) {
  const paperDir = path.join(input.workspaceRoot, "Papers", "demo-paper");
  await fs.mkdir(path.join(paperDir, "figures"), { recursive: true });
  const title = input.title ?? "A publishable paper from the desktop app";
  const abstract =
    input.abstract ??
    "This abstract is intentionally long enough to satisfy the platform validation and prove that the desktop app can publish a fully local paper bundle through the canonical API.";
  await fs.writeFile(
    path.join(paperDir, "paper.tex"),
    [
      `\\title{${title}}`,
      "\\begin{abstract}",
      abstract,
      "\\end{abstract}",
      "\\begin{document}",
      "Published from the desktop app.",
      "\\end{document}",
      "",
    ].join("\n"),
    "utf8",
  );
  await fs.writeFile(path.join(paperDir, "paper.pdf"), "%PDF-1.4\npaper\n", "utf8");
  await fs.writeFile(
    path.join(paperDir, "references.bib"),
    "@article{demo,title={Desktop Publish}}\n",
    "utf8",
  );
  await fs.writeFile(path.join(paperDir, "figures", "figure-1.png"), Buffer.from([0x89, 0x50]));
  return paperDir;
}

async function startUpstreamServer(
  handler: (request: {
    readonly method: string;
    readonly url: string;
    readonly authorization: string | null;
    readonly contentType: string | null;
  }) => {
    readonly status: number;
    readonly body: unknown;
  },
): Promise<{
  readonly baseUrl: string;
  readonly close: () => Promise<void>;
}> {
  const NodeHttp = await import("node:http");

  return new Promise((resolve, reject) => {
    const server = NodeHttp.createServer((request, response) => {
      const result = handler({
        method: request.method ?? "GET",
        url: request.url ?? "/",
        authorization: request.headers.authorization ?? null,
        contentType: request.headers["content-type"] ?? null,
      });
      response.statusCode = result.status;
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify(result.body));
    });

    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Expected a TCP address."));
        return;
      }

      resolve({
        baseUrl: `http://127.0.0.1:${address.port}`,
        close: () =>
          new Promise<void>((resolveClose, rejectClose) => {
            server.close((error) => {
              if (error) {
                rejectClose(error);
                return;
              }
              resolveClose();
            });
          }),
      });
    });
  });
}

async function makeService(input: {
  readonly workspaceRoot: string;
  readonly baseUrl: string;
  readonly userId?: string;
  readonly handle?: string;
}) {
  const layer = Layer.mergeAll(
    Layer.mock(ServerSettingsService)({
      getSettings: Effect.succeed({
        workspaceRoot: input.workspaceRoot,
      } as any),
    }),
    Layer.mock(OrchestrationEngineService)({
      getReadModel: () =>
        Effect.succeed({
          snapshotSequence: 0,
          threads: [],
          projects: [],
          updatedAt: "2026-04-21T12:00:00.000Z",
        }),
    }),
    Layer.mock(AgentScienceAuthService)({
      getState: Effect.succeed({
        status: "signed-in" as const,
        updatedAt: "2026-04-21T12:00:00.000Z",
        baseUrl: input.baseUrl,
        user: {
          id: input.userId ?? "user-1",
          name: "Researcher One",
          handle: input.handle ?? "researcherone",
          email: "researcher@example.com",
          institution: null,
          publicationProfileComplete: true,
          publishNameRequired: false,
        },
      }),
      getBearerToken: Effect.succeed("agsk_desktop_test"),
    }),
    Layer.succeed(ServerConfig, {
      agentScienceBaseUrl: input.baseUrl,
    } as any),
  );

  return Effect.runPromise(makeLocalPapersService.pipe(Effect.provide(layer)));
}

describe("local paper publish flow", () => {
  afterEach(() => {
    __internal.resetBlobUploaderForTests();
    __internal.resetBlobCleanerForTests();
  });

  it("publishes a local paper bundle and persists the published metadata", async () => {
    const workspaceRoot = await makeTempWorkspaceRoot();
    const paperDir = await writePaperWorkspace({ workspaceRoot });
    const calls: Array<{ method: string; url: string; authorization: string | null }> = [];
    __internal.setBlobUploaderForTests(async (input) => ({
      url: `https://blob.example.test/${input.uploadId}/${input.role}/${input.fileName}`,
      pathname: `${input.uploadId}/${input.role}/${input.fileName}`,
      downloadUrl: `https://blob.example.test/${input.uploadId}/${input.role}/${input.fileName}?download=1`,
      sizeBytes: input.bytes.length,
    }));
    const upstream = await startUpstreamServer((request) => {
      calls.push({
        method: request.method,
        url: request.url,
        authorization: request.authorization,
      });
      expect(request.contentType).toContain("application/json");
      return {
        status: 200,
        body: {
          paper: {
            id: "remote-paper-1",
            slug: "desktop-paper",
            publishedAt: "2026-04-21T18:00:00.000Z",
          },
        },
      };
    });

    try {
      const service = await makeService({
        workspaceRoot,
        baseUrl: upstream.baseUrl,
      });
      const published = await Effect.runPromise(
        service.publish(__internal.encodePaperId(paperDir)),
      );

      expect(published.publication).toEqual({
        remotePaperId: "remote-paper-1",
        slug: "desktop-paper",
        url: `${upstream.baseUrl}/papers/desktop-paper`,
        publishedAt: "2026-04-21T18:00:00.000Z",
      });
      expect(calls).toEqual([
        {
          method: "POST",
          url: "/api/v1/papers",
          authorization: "Bearer agsk_desktop_test",
        },
      ]);

      const metadataPath = path.join(paperDir, __internal.PUBLISHED_METADATA_FILENAME);
      const rawMetadata = await fs.readFile(metadataPath, "utf8");
      expect(JSON.parse(rawMetadata)).toMatchObject({
        ownerUserId: "user-1",
        remotePaperId: "remote-paper-1",
        slug: "desktop-paper",
      });
    } finally {
      await upstream.close();
    }
  });

  it("republishes to the same remote paper for the same connected account", async () => {
    const workspaceRoot = await makeTempWorkspaceRoot();
    const paperDir = await writePaperWorkspace({ workspaceRoot });
    const calls: string[] = [];
    let publishCount = 0;
    __internal.setBlobUploaderForTests(async (input) => ({
      url: `https://blob.example.test/${input.uploadId}/${input.role}/${input.fileName}`,
      pathname: `${input.uploadId}/${input.role}/${input.fileName}`,
      downloadUrl: `https://blob.example.test/${input.uploadId}/${input.role}/${input.fileName}?download=1`,
      sizeBytes: input.bytes.length,
    }));
    const upstream = await startUpstreamServer((request) => {
      calls.push(`${request.method} ${request.url}`);
      publishCount += 1;
      return {
        status: 200,
        body: {
          paper: {
            id: "remote-paper-1",
            slug: "desktop-paper",
            publishedAt:
              publishCount === 1 ? "2026-04-21T18:00:00.000Z" : "2026-04-21T19:00:00.000Z",
          },
        },
      };
    });

    try {
      const service = await makeService({
        workspaceRoot,
        baseUrl: upstream.baseUrl,
      });
      const paperId = __internal.encodePaperId(paperDir);

      await Effect.runPromise(service.publish(paperId));
      await Effect.runPromise(service.publish(paperId));

      expect(calls).toEqual(["POST /api/v1/papers", "PATCH /api/v1/papers/desktop-paper"]);
    } finally {
      await upstream.close();
    }
  });

  it("creates a new remote paper when the stored publication belongs to a different account", async () => {
    const workspaceRoot = await makeTempWorkspaceRoot();
    const paperDir = await writePaperWorkspace({ workspaceRoot });
    await fs.writeFile(
      path.join(paperDir, __internal.PUBLISHED_METADATA_FILENAME),
      JSON.stringify({
        version: 1,
        ownerUserId: "other-user",
        remotePaperId: "remote-paper-old",
        slug: "other-account-paper",
        url: "https://agentscience.example/papers/other-account-paper",
        publishedAt: "2026-04-20T12:00:00.000Z",
      }),
      "utf8",
    );

    const calls: string[] = [];
    __internal.setBlobUploaderForTests(async (input) => ({
      url: `https://blob.example.test/${input.uploadId}/${input.role}/${input.fileName}`,
      pathname: `${input.uploadId}/${input.role}/${input.fileName}`,
      downloadUrl: `https://blob.example.test/${input.uploadId}/${input.role}/${input.fileName}?download=1`,
      sizeBytes: input.bytes.length,
    }));
    const upstream = await startUpstreamServer((request) => {
      calls.push(`${request.method} ${request.url}`);
      return {
        status: 200,
        body: {
          paper: {
            id: "remote-paper-new",
            slug: "desktop-paper-fresh",
            publishedAt: "2026-04-21T20:00:00.000Z",
          },
        },
      };
    });

    try {
      const service = await makeService({
        workspaceRoot,
        baseUrl: upstream.baseUrl,
        userId: "user-2",
        handle: "researchertwo",
      });
      await Effect.runPromise(service.publish(__internal.encodePaperId(paperDir)));

      expect(calls).toEqual(["POST /api/v1/papers"]);
    } finally {
      await upstream.close();
    }
  });

  it("excludes files matched by .agentscienceignore from the uploaded bundle", async () => {
    const workspaceRoot = await makeTempWorkspaceRoot();
    const paperDir = await writePaperWorkspace({ workspaceRoot });
    await fs.mkdir(path.join(paperDir, ".agentscience-review"), { recursive: true });
    await fs.writeFile(
      path.join(paperDir, ".agentscience-review", "paper.tex"),
      "\\title{Generated preview}",
      "utf8",
    );
    await fs.writeFile(path.join(paperDir, "analysis.log"), "internal log", "utf8");
    await fs.writeFile(
      path.join(paperDir, __internal.AGENTSCIENCE_IGNORE_FILENAME),
      [".agentscience-review/", "*.log", ""].join("\n"),
      "utf8",
    );

    const uploadedPaths: string[] = [];
    __internal.setBlobUploaderForTests(async (input) => {
      uploadedPaths.push(`${input.role}/${input.relativePath}`);
      return {
        url: `https://blob.example.test/${input.uploadId}/${input.role}/${input.fileName}`,
        pathname: `${input.uploadId}/${input.role}/${input.fileName}`,
        downloadUrl: `https://blob.example.test/${input.uploadId}/${input.role}/${input.fileName}?download=1`,
        sizeBytes: input.bytes.length,
      };
    });
    const upstream = await startUpstreamServer(() => ({
      status: 200,
      body: {
        paper: {
          id: "remote-paper-ignore",
          slug: "desktop-paper-ignore",
          publishedAt: "2026-04-21T20:00:00.000Z",
        },
      },
    }));

    try {
      const service = await makeService({
        workspaceRoot,
        baseUrl: upstream.baseUrl,
      });
      await Effect.runPromise(service.publish(__internal.encodePaperId(paperDir)));

      expect(uploadedPaths).not.toContain("artifacts/analysis.log");
      expect(uploadedPaths).not.toContain("artifacts/.agentscience-review/paper.tex");
      expect(uploadedPaths).toContain("artifacts/paper.tex");
      expect(uploadedPaths).toEqual(
        expect.arrayContaining(["pdf/paper.pdf", "figures/figure-1.png"]),
      );
    } finally {
      await upstream.close();
    }
  });

  it("cleans up uploaded blobs when the publish API rejects the metadata", async () => {
    const workspaceRoot = await makeTempWorkspaceRoot();
    const paperDir = await writePaperWorkspace({ workspaceRoot });
    const cleanedPathnames: string[][] = [];
    __internal.setBlobUploaderForTests(async (input) => ({
      url: `https://blob.example.test/${input.uploadId}/${input.role}/${input.fileName}`,
      pathname: `${input.uploadId}/${input.role}/${input.fileName}`,
      downloadUrl: `https://blob.example.test/${input.uploadId}/${input.role}/${input.fileName}?download=1`,
      sizeBytes: input.bytes.length,
    }));
    __internal.setBlobCleanerForTests(async (input) => {
      cleanedPathnames.push([...input.pathnames]);
    });
    const upstream = await startUpstreamServer(() => ({
      status: 400,
      body: { error: "Invalid uploaded file metadata." },
    }));

    try {
      const service = await makeService({
        workspaceRoot,
        baseUrl: upstream.baseUrl,
      });

      await expect(
        Effect.runPromise(service.publish(__internal.encodePaperId(paperDir))),
      ).rejects.toThrow("Invalid uploaded file metadata.");

      expect(cleanedPathnames).toHaveLength(1);
      expect(cleanedPathnames[0]).toEqual(
        expect.arrayContaining([
          expect.stringContaining("/pdf/paper.pdf"),
          expect.stringContaining("/figures/figure-1.png"),
        ]),
      );
    } finally {
      await upstream.close();
    }
  });
});
