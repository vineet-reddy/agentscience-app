import {
  canvasBrowserRoutePath,
  type CanvasBrowserAction,
  type CanvasBrowserState,
  type ThreadId,
} from "@agentscience/contracts";
import { resolveServerUrl } from "./utils";

function resolveCanvasBrowserRequestUrl(threadId: ThreadId, suffix = ""): string {
  return new URL(
    `${canvasBrowserRoutePath(threadId)}${suffix}`,
    resolveServerUrl({
      protocol: "http",
      pathname: "/",
    }),
  ).toString();
}

async function parseCanvasBrowserResponse(response: Response): Promise<CanvasBrowserState> {
  if (!response.ok) {
    throw new Error(`Canvas browser request failed with status ${response.status}.`);
  }
  return (await response.json()) as CanvasBrowserState;
}

export async function fetchCanvasBrowserState(threadId: ThreadId): Promise<CanvasBrowserState> {
  return parseCanvasBrowserResponse(
    await fetch(resolveCanvasBrowserRequestUrl(threadId), {
      credentials: "same-origin",
    }),
  );
}

export async function recordCanvasBrowserSnapshot(
  threadId: ThreadId,
  snapshot: {
    currentUrl: string;
    title?: string;
    text?: string;
    screenshotDataUrl?: string;
    viewport?: CanvasBrowserState["viewport"];
    status?: CanvasBrowserState["status"];
    message?: string;
    detectedBlocker?: CanvasBrowserState["detectedBlocker"];
  },
): Promise<CanvasBrowserState> {
  return parseCanvasBrowserResponse(
    await fetch(resolveCanvasBrowserRequestUrl(threadId, "/snapshot"), {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(snapshot),
    }),
  );
}

export async function recordCanvasBrowserActionResult(
  threadId: ThreadId,
  actionId: CanvasBrowserAction["id"],
  result: {
    status: "success" | "error";
    message?: string;
  },
): Promise<CanvasBrowserState> {
  return parseCanvasBrowserResponse(
    await fetch(resolveCanvasBrowserRequestUrl(threadId, `/actions/${encodeURIComponent(actionId)}/result`), {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(result),
    }),
  );
}
