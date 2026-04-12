import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

const MAC_APP_ICON_FILE = "app-icon.icns";
const MAC_APP_DOCK_ICON_FILE = "app-icon.png";

function setPlistString(plistPath, key, value) {
  const replaceResult = spawnSync("plutil", ["-replace", key, "-string", value, plistPath], {
    encoding: "utf8",
  });
  if (replaceResult.status === 0) {
    return;
  }

  const insertResult = spawnSync("plutil", ["-insert", key, "-string", value, plistPath], {
    encoding: "utf8",
  });
  if (insertResult.status === 0) {
    return;
  }

  const details = [replaceResult.stderr, insertResult.stderr].filter(Boolean).join("\n");
  throw new Error(`Failed to update plist key "${key}" at ${plistPath}: ${details}`.trim());
}

export default async function afterPack(context) {
  if (context.electronPlatformName !== "darwin") {
    return;
  }

  const appBundleName = readdirSync(context.appOutDir).find((entry) => entry.endsWith(".app"));
  if (!appBundleName) {
    throw new Error(`Could not find packaged app bundle in ${context.appOutDir}`);
  }

  const appBundlePath = join(context.appOutDir, appBundleName);
  const resourcesDir = join(appBundlePath, "Contents", "Resources");
  const stagedResourcesDir = join(context.packager.projectDir, "apps", "desktop", "resources");
  const icnsSource = join(stagedResourcesDir, MAC_APP_ICON_FILE);
  const pngSource = join(stagedResourcesDir, MAC_APP_DOCK_ICON_FILE);

  if (!existsSync(icnsSource)) {
    throw new Error(`Missing staged mac icon at ${icnsSource}`);
  }

  copyFileSync(icnsSource, join(resourcesDir, MAC_APP_ICON_FILE));
  if (existsSync(pngSource)) {
    copyFileSync(pngSource, join(resourcesDir, MAC_APP_DOCK_ICON_FILE));
  }

  setPlistString(join(appBundlePath, "Contents", "Info.plist"), "CFBundleIconFile", MAC_APP_ICON_FILE);
}
