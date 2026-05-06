import { randomUUID } from "node:crypto";
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream, existsSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pipeline } from "node:stream/promises";

import type { ChatAttachment } from "@agentscience/contracts";
import { PROVIDER_SEND_TURN_MAX_FILE_BYTES } from "@agentscience/contracts";
import Mime from "@effect/platform-node/Mime";

import {
  normalizeAttachmentRelativePath,
  resolveAttachmentRelativePath,
} from "./attachmentPaths.ts";
import { toSafeAttachmentFileName } from "./attachmentNames.ts";
import { inferImageExtension, SAFE_IMAGE_FILE_EXTENSIONS } from "./imageMime.ts";

const ATTACHMENT_FILENAME_EXTENSIONS = [...SAFE_IMAGE_FILE_EXTENSIONS, ".bin"];
const ATTACHMENT_ID_THREAD_SEGMENT_MAX_CHARS = 80;
const ATTACHMENT_ID_THREAD_SEGMENT_PATTERN = "[a-z0-9_]+(?:-[a-z0-9_]+)*";
const ATTACHMENT_ID_UUID_PATTERN = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const ATTACHMENT_ID_PATTERN = new RegExp(
  `^(${ATTACHMENT_ID_THREAD_SEGMENT_PATTERN})-(${ATTACHMENT_ID_UUID_PATTERN})$`,
  "i",
);
const DEFAULT_FILE_MIME_TYPE = "application/octet-stream";

export function toSafeThreadAttachmentSegment(threadId: string): string | null {
  const segment = threadId
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/gi, "-")
    .replace(/-+/g, "-")
    .replace(/^[-_]+|[-_]+$/g, "")
    .slice(0, ATTACHMENT_ID_THREAD_SEGMENT_MAX_CHARS)
    .replace(/[-_]+$/g, "");
  if (segment.length === 0) {
    return null;
  }
  return segment;
}

export function createAttachmentId(threadId: string): string | null {
  const threadSegment = toSafeThreadAttachmentSegment(threadId);
  if (!threadSegment) {
    return null;
  }
  return `${threadSegment}-${randomUUID()}`;
}

export function parseThreadSegmentFromAttachmentId(attachmentId: string): string | null {
  const normalizedId = normalizeAttachmentRelativePath(attachmentId);
  if (!normalizedId || normalizedId.includes("/") || normalizedId.includes(".")) {
    return null;
  }
  const match = normalizedId.match(ATTACHMENT_ID_PATTERN);
  if (!match) {
    return null;
  }
  return match[1]?.toLowerCase() ?? null;
}

export function attachmentRelativePath(attachment: ChatAttachment): string {
  switch (attachment.type) {
    case "image": {
      const extension = inferImageExtension({
        mimeType: attachment.mimeType,
        fileName: attachment.name,
      });
      return `${attachment.id}${extension}`;
    }
    case "file":
      return `${attachment.id}/${attachment.storageName}`;
  }
}

export function resolveAttachmentPath(input: {
  readonly attachmentsDir: string;
  readonly attachment: ChatAttachment;
}): string | null {
  return resolveAttachmentRelativePath({
    attachmentsDir: input.attachmentsDir,
    relativePath: attachmentRelativePath(input.attachment),
  });
}

export function resolveAttachmentPathById(input: {
  readonly attachmentsDir: string;
  readonly attachmentId: string;
}): string | null {
  const normalizedId = normalizeAttachmentRelativePath(input.attachmentId);
  if (!normalizedId || normalizedId.includes("/") || normalizedId.includes(".")) {
    return null;
  }
  for (const extension of ATTACHMENT_FILENAME_EXTENSIONS) {
    const maybePath = resolveAttachmentRelativePath({
      attachmentsDir: input.attachmentsDir,
      relativePath: `${normalizedId}${extension}`,
    });
    if (maybePath && existsSync(maybePath)) {
      return maybePath;
    }
  }
  return null;
}

export function parseAttachmentIdFromRelativePath(relativePath: string): string | null {
  const normalized = normalizeAttachmentRelativePath(relativePath);
  if (!normalized) {
    return null;
  }
  if (normalized.includes("/")) {
    const [id, ...rest] = normalized.split("/");
    return id && rest.length > 0 && !id.includes(".") ? id : null;
  }
  const extensionIndex = normalized.lastIndexOf(".");
  if (extensionIndex <= 0) {
    return null;
  }
  const id = normalized.slice(0, extensionIndex);
  return id.length > 0 && !id.includes(".") ? id : null;
}

function inferMimeType(fileName: string): string {
  const inferred = Mime.getType(fileName);
  return inferred && inferred.trim().length > 0 ? inferred.toLowerCase() : DEFAULT_FILE_MIME_TYPE;
}

async function copyAndHashFile(input: {
  readonly sourcePath: string;
  readonly destinationPath: string;
}): Promise<string> {
  const hash = createHash("sha256");
  await pipeline(createReadStream(input.sourcePath), async function* (source) {
    for await (const chunk of source) {
      hash.update(chunk);
      yield chunk;
    }
  }, createWriteStream(input.destinationPath, { flags: "wx", mode: 0o600 }));
  return hash.digest("hex");
}

export async function importAttachmentFromPath(input: {
  readonly attachmentsDir: string;
  readonly threadId: string;
  readonly sourcePath: string;
}): Promise<ChatAttachment> {
  const sourcePath = path.resolve(input.sourcePath);
  const sourceStat = await fs.stat(sourcePath).catch(() => {
    throw new Error("Selected file could not be read.");
  });
  if (!sourceStat.isFile()) {
    throw new Error("Only regular files can be attached.");
  }
  if (sourceStat.size <= 0) {
    throw new Error("Attached file is empty.");
  }
  if (sourceStat.size > PROVIDER_SEND_TURN_MAX_FILE_BYTES) {
    throw new Error("Attached file is too large.");
  }

  const attachmentId = createAttachmentId(input.threadId);
  if (!attachmentId) {
    throw new Error("Failed to create a safe attachment id.");
  }

  const originalName = path.basename(sourcePath) || "attachment";
  const mimeType = inferMimeType(originalName);
  const storageName = toSafeAttachmentFileName(originalName);
  const relativePath = `${attachmentId}/${storageName}`;
  const destinationPath = resolveAttachmentRelativePath({
    attachmentsDir: input.attachmentsDir,
    relativePath,
  });
  if (!destinationPath) {
    throw new Error("Failed to resolve attachment destination.");
  }

  await fs.mkdir(path.dirname(destinationPath), { recursive: true }).catch(() => {
    throw new Error("Failed to prepare AgentScience attachment storage.");
  });
  const tempPath = path.join(
    path.dirname(destinationPath),
    `.${path.basename(destinationPath)}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`,
  );
  try {
    const sha256 = await copyAndHashFile({ sourcePath, destinationPath: tempPath });
    await fs.rename(tempPath, destinationPath);
    if (os.platform() !== "win32") {
      await fs.chmod(destinationPath, 0o444).catch(() => undefined);
    }
    return {
      type: "file",
      id: attachmentId,
      name: originalName,
      mimeType,
      sizeBytes: sourceStat.size,
      sha256,
      storageName,
    };
  } catch {
    await fs.rm(tempPath, { force: true }).catch(() => undefined);
    await fs.rm(destinationPath, { force: true, recursive: true }).catch(() => undefined);
    throw new Error("Failed to copy selected file into AgentScience storage.");
  }
}
