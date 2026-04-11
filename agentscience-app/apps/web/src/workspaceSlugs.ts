export function slugifyWorkspaceName(value: string, fallback: string): string {
  const cleaned = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return cleaned.length > 0 ? cleaned : fallback;
}

export function nextWorkspaceSlug(
  value: string,
  existingSlugs: Iterable<string>,
  fallback: string,
): string {
  const taken = new Set(existingSlugs);
  const baseSlug = slugifyWorkspaceName(value, fallback);
  if (!taken.has(baseSlug)) {
    return baseSlug;
  }

  let suffix = 2;
  while (suffix < 10_000) {
    const candidate = `${baseSlug}-${suffix}`;
    if (!taken.has(candidate)) {
      return candidate;
    }
    suffix += 1;
  }

  return `${baseSlug}-${Date.now()}`;
}
