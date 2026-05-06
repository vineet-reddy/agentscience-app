import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  attachmentRelativePath,
  createAttachmentId,
  importAttachmentFromPath,
  parseThreadSegmentFromAttachmentId,
  resolveAttachmentPath,
  resolveAttachmentPathById,
} from "./attachmentStore.ts";
import { toPromptSafeFileLabel, toSafeAttachmentFileName } from "./attachmentNames.ts";

describe("attachmentStore", () => {
  it("normalizes attachment filenames and prompt labels", () => {
    expect(toSafeAttachmentFileName(" source data FINAL.csv ")).toBe("source-data-FINAL.csv");
    expect(toPromptSafeFileLabel("source\nignore this.csv")).toBe("source ignore this.csv");
    expect(toPromptSafeFileLabel("\u0000\u001f")).toBe("attachment");
  });

  it("sanitizes thread ids when creating attachment ids", () => {
    const attachmentId = createAttachmentId("thread.folder/unsafe space");
    expect(attachmentId).toBeTruthy();
    if (!attachmentId) {
      return;
    }

    const threadSegment = parseThreadSegmentFromAttachmentId(attachmentId);
    expect(threadSegment).toBeTruthy();
    expect(threadSegment).toMatch(/^[a-z0-9_-]+$/i);
    expect(threadSegment).not.toContain(".");
    expect(threadSegment).not.toContain("%");
    expect(threadSegment).not.toContain("/");
  });

  it("parses exact thread segments from attachment ids without prefix collisions", () => {
    const fooId = "foo-00000000-0000-4000-8000-000000000001";
    const fooBarId = "foo-bar-00000000-0000-4000-8000-000000000002";

    expect(parseThreadSegmentFromAttachmentId(fooId)).toBe("foo");
    expect(parseThreadSegmentFromAttachmentId(fooBarId)).toBe("foo-bar");
  });

  it("normalizes created thread segments to lowercase", () => {
    const attachmentId = createAttachmentId("Thread.Foo");
    expect(attachmentId).toBeTruthy();
    if (!attachmentId) {
      return;
    }
    expect(parseThreadSegmentFromAttachmentId(attachmentId)).toBe("thread-foo");
  });

  it("resolves attachment path by id using the extension that exists on disk", () => {
    const attachmentsDir = fs.mkdtempSync(path.join(os.tmpdir(), "agentscience-attachment-store-"));
    try {
      const attachmentId = "thread-1-attachment";
      const pngPath = path.join(attachmentsDir, `${attachmentId}.png`);
      fs.writeFileSync(pngPath, Buffer.from("hello"));

      const resolved = resolveAttachmentPathById({
        attachmentsDir,
        attachmentId,
      });
      expect(resolved).toBe(pngPath);
    } finally {
      fs.rmSync(attachmentsDir, { recursive: true, force: true });
    }
  });

  it("returns null when no attachment file exists for the id", () => {
    const attachmentsDir = fs.mkdtempSync(path.join(os.tmpdir(), "agentscience-attachment-store-"));
    try {
      const resolved = resolveAttachmentPathById({
        attachmentsDir,
        attachmentId: "thread-1-missing",
      });
      expect(resolved).toBeNull();
    } finally {
      fs.rmSync(attachmentsDir, { recursive: true, force: true });
    }
  });

  it("imports arbitrary files as preserved copies without mutating the source", async () => {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "agentscience-attachment-store-"));
    const sourcePath = path.join(rootDir, "source data.csv");
    const attachmentsDir = path.join(rootDir, "attachments");
    const sourceContents = "subject,value\nalpha,1\n";
    fs.writeFileSync(sourcePath, sourceContents);

    try {
      const attachment = await importAttachmentFromPath({
        attachmentsDir,
        threadId: "thread-file-test",
        sourcePath,
      });

      expect(attachment.type).toBe("file");
      if (attachment.type !== "file") {
        throw new Error("Expected imported attachment to be a file attachment.");
      }
      expect(attachment.name).toBe("source data.csv");
      expect(attachment.storageName).toBe("source-data.csv");
      expect(attachment.sizeBytes).toBe(Buffer.byteLength(sourceContents));
      expect(attachment.sha256).toHaveLength(64);
      expect(attachmentRelativePath(attachment)).toBe(`${attachment.id}/source-data.csv`);
      expect(fs.readFileSync(sourcePath, "utf8")).toBe(sourceContents);

      const storedPath = resolveAttachmentPath({ attachmentsDir, attachment });
      expect(storedPath).toBeTruthy();
      expect(storedPath).not.toBe(sourcePath);
      expect(fs.readFileSync(storedPath!, "utf8")).toBe(sourceContents);
    } finally {
      fs.rmSync(rootDir, { recursive: true, force: true });
    }
  });

  it("does not expose selected paths in import errors", async () => {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "agentscience-attachment-store-"));
    const missingPath = path.join(rootDir, "private", "missing.csv");
    try {
      await expect(
        importAttachmentFromPath({
          attachmentsDir: path.join(rootDir, "attachments"),
          threadId: "thread-file-test",
          sourcePath: missingPath,
        }),
      ).rejects.toThrow("Selected file could not be read.");
      await expect(
        importAttachmentFromPath({
          attachmentsDir: path.join(rootDir, "attachments"),
          threadId: "thread-file-test",
          sourcePath: missingPath,
        }),
      ).rejects.not.toThrow(missingPath);
    } finally {
      fs.rmSync(rootDir, { recursive: true, force: true });
    }
  });
});
