import * as Path from "node:path";

export function resolveDesktopStateDir(baseDir: string, isDevelopment: boolean): string {
  return Path.join(baseDir, isDevelopment ? "dev" : "userdata");
}

export function resolveDesktopServerSettingsPath(baseDir: string, isDevelopment: boolean): string {
  return Path.join(resolveDesktopStateDir(baseDir, isDevelopment), "settings.json");
}

export function resolveDefaultDesktopCodexHomePath(
  baseDir: string,
  isDevelopment: boolean,
): string {
  return Path.join(resolveDesktopStateDir(baseDir, isDevelopment), "codex");
}
