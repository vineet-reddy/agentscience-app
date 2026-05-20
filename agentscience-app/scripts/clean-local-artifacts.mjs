#!/usr/bin/env node

import { existsSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

const removePaths = new Set([
  "node_modules",
  ".bun",
  ".turbo",
  ".cache",
  ".vite",
  ".tanstack",
  "build",
  ".logs",
  "release",
  "release-mock",
  "apps/web/.playwright",
  "apps/web/playwright-report",
  "apps/web/src/components/__screenshots__",
]);

function addWorkspaceGeneratedPaths(parent) {
  const parentPath = join(repoRoot, parent);
  if (!existsSync(parentPath)) {
    return;
  }

  for (const entry of readdirSync(parentPath, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }

    const workspacePath = `${parent}/${entry.name}`;
    removePaths.add(`${workspacePath}/node_modules`);
    removePaths.add(`${workspacePath}/dist`);
    removePaths.add(`${workspacePath}/dist-electron`);
    removePaths.add(`${workspacePath}/.turbo`);
    removePaths.add(`${workspacePath}/.cache`);
    removePaths.add(`${workspacePath}/.vite`);
  }
}

function addManagedResourceGeneratedPaths() {
  const managedResourcesPath = join(repoRoot, "apps/desktop/managed-resources");
  if (!existsSync(managedResourcesPath)) {
    return;
  }

  removePaths.add("apps/desktop/managed-resources/.manifest.json");

  for (const resource of readdirSync(managedResourcesPath, { withFileTypes: true })) {
    if (!resource.isDirectory()) {
      continue;
    }

    const resourcePath = join(managedResourcesPath, resource.name);
    for (const target of readdirSync(resourcePath, { withFileTypes: true })) {
      if (!target.isDirectory()) {
        continue;
      }
      if (/^(darwin|linux|win32)-/.test(target.name)) {
        removePaths.add(`apps/desktop/managed-resources/${resource.name}/${target.name}`);
      }
    }
  }
}

function removeGeneratedPath(relativePath) {
  const absolutePath = join(repoRoot, relativePath);
  rmSync(absolutePath, { recursive: true, force: true });
}

function removeIgnoredMetadataFiles() {
  const stack = [repoRoot];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current || !existsSync(current)) {
      continue;
    }

    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const entryPath = join(current, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name === ".git") {
          continue;
        }
        stack.push(entryPath);
        continue;
      }

      if (entry.name === ".DS_Store" || entry.name.endsWith(".tsbuildinfo")) {
        rmSync(entryPath, { force: true });
      }
    }
  }
}

addWorkspaceGeneratedPaths("apps");
addWorkspaceGeneratedPaths("packages");
addManagedResourceGeneratedPaths();

for (const relativePath of [...removePaths].toSorted()) {
  removeGeneratedPath(relativePath);
}

removeIgnoredMetadataFiles();
