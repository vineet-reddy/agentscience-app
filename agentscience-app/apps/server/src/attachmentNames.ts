import path from "node:path";

export function toSafeAttachmentFileName(input: string): string {
  const parsed = path.parse(input.trim() || "attachment");
  const base = (parsed.name || "attachment")
    .normalize("NFKD")
    .replace(/[^a-z0-9._-]+/gi, "-")
    .replace(/-+/g, "-")
    .replace(/^[-_.]+|[-_.]+$/g, "")
    .slice(0, 160)
    .replace(/[-_.]+$/g, "");
  const extension = parsed.ext
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, "")
    .slice(0, 32);
  return `${base || "attachment"}${extension}`.slice(0, 220) || "attachment";
}

export function toPromptSafeFileLabel(input: string): string {
  const label = Array.from(input)
    .map((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint < 32 || codePoint === 127 ? " " : character;
    })
    .join("")
    .replace(/\s+/g, " ")
    .trim();
  return label.length > 0 ? label : "attachment";
}
