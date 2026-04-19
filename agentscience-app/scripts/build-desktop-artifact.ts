#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

import rootPackageJson from "../package.json" with { type: "json" };
import desktopPackageJson from "../apps/desktop/package.json" with { type: "json" };
import serverPackageJson from "../apps/server/package.json" with { type: "json" };

import { BRAND_ASSET_PATHS } from "./lib/brand-assets.ts";
import { resolveCatalogDependencies } from "./lib/resolve-catalog.ts";

import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { Config, Data, Effect, FileSystem, Layer, Logger, Option, Path, Schema } from "effect";
import { Command, Flag } from "effect/unstable/cli";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

const BuildPlatform = Schema.Literals(["mac", "linux", "win"]);
const BuildArch = Schema.Literals(["arm64", "x64", "universal"]);
const PACKAGED_PINNED_DEPENDENCIES = {
  "@effect/platform-node-shared": "4.0.0-beta.43",
} as const;
const MANAGED_CODEX_RESOURCE_DIR = "codex-runtime";

const RepoRoot = Effect.service(Path.Path).pipe(
  Effect.flatMap((path) => path.fromFileUrl(new URL("..", import.meta.url))),
);
const ProductionMacIconSource = Effect.zipWith(
  RepoRoot,
  Effect.service(Path.Path),
  (repoRoot, path) => path.join(repoRoot, BRAND_ASSET_PATHS.productionMacIconPng),
);
const ProductionLinuxIconSource = Effect.zipWith(
  RepoRoot,
  Effect.service(Path.Path),
  (repoRoot, path) => path.join(repoRoot, BRAND_ASSET_PATHS.productionLinuxIconPng),
);
const ProductionWindowsIconSource = Effect.zipWith(
  RepoRoot,
  Effect.service(Path.Path),
  (repoRoot, path) => path.join(repoRoot, BRAND_ASSET_PATHS.productionWindowsIconIco),
);
const encodeJsonString = Schema.encodeEffect(Schema.UnknownFromJsonString);

interface PlatformConfig {
  readonly cliFlag: "--mac" | "--linux" | "--win";
  readonly defaultTarget: string;
  readonly archChoices: ReadonlyArray<typeof BuildArch.Type>;
}

interface ManagedCodexTarget {
  readonly packageName: string;
  readonly packageVersionSuffix: string;
  readonly targetTriple: string;
}

const PLATFORM_CONFIG: Record<typeof BuildPlatform.Type, PlatformConfig> = {
  mac: {
    cliFlag: "--mac",
    defaultTarget: "dmg",
    archChoices: ["arm64", "x64", "universal"],
  },
  linux: {
    cliFlag: "--linux",
    defaultTarget: "AppImage",
    archChoices: ["x64", "arm64"],
  },
  win: {
    cliFlag: "--win",
    defaultTarget: "nsis",
    archChoices: ["x64", "arm64"],
  },
};

interface BuildCliInput {
  readonly platform: Option.Option<typeof BuildPlatform.Type>;
  readonly target: Option.Option<string>;
  readonly arch: Option.Option<typeof BuildArch.Type>;
  readonly buildVersion: Option.Option<string>;
  readonly outputDir: Option.Option<string>;
  readonly skipBuild: Option.Option<boolean>;
  readonly keepStage: Option.Option<boolean>;
  readonly signed: Option.Option<boolean>;
  readonly verbose: Option.Option<boolean>;
  readonly mockUpdates: Option.Option<boolean>;
  readonly mockUpdateServerPort: Option.Option<string>;
}

function detectHostBuildPlatform(hostPlatform: string): typeof BuildPlatform.Type | undefined {
  if (hostPlatform === "darwin") return "mac";
  if (hostPlatform === "linux") return "linux";
  if (hostPlatform === "win32") return "win";
  return undefined;
}

function getDefaultArch(platform: typeof BuildPlatform.Type): typeof BuildArch.Type {
  const config = PLATFORM_CONFIG[platform];
  if (!config) {
    return "x64";
  }

  if (process.arch === "arm64" && config.archChoices.includes("arm64")) {
    return "arm64";
  }
  if (process.arch === "x64" && config.archChoices.includes("x64")) {
    return "x64";
  }

  return config.archChoices[0] ?? "x64";
}

class BuildScriptError extends Data.TaggedError("BuildScriptError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

function resolveGitCommitHash(repoRoot: string): string {
  const result = spawnSync("git", ["rev-parse", "--short=12", "HEAD"], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    return "unknown";
  }
  const hash = result.stdout.trim();
  if (!/^[0-9a-f]{7,40}$/i.test(hash)) {
    return "unknown";
  }
  return hash.toLowerCase();
}

function resolvePythonForNodeGyp(): string | undefined {
  const configured = process.env.npm_config_python ?? process.env.PYTHON;
  if (configured && existsSync(configured)) {
    return configured;
  }

  if (process.platform === "win32") {
    const localAppData = process.env.LOCALAPPDATA;
    if (localAppData) {
      for (const version of ["Python313", "Python312", "Python311", "Python310"]) {
        const candidate = join(localAppData, "Programs", "Python", version, "python.exe");
        if (existsSync(candidate)) {
          return candidate;
        }
      }
    }
  }

  const probe = spawnSync("python", ["-c", "import sys;print(sys.executable)"], {
    encoding: "utf8",
  });
  if (probe.status !== 0) {
    return undefined;
  }

  const executable = probe.stdout.trim();
  if (!executable || !existsSync(executable)) {
    return undefined;
  }

  return executable;
}

interface ResolvedBuildOptions {
  readonly platform: typeof BuildPlatform.Type;
  readonly target: string;
  readonly arch: typeof BuildArch.Type;
  readonly version: string | undefined;
  readonly outputDir: string;
  readonly skipBuild: boolean;
  readonly keepStage: boolean;
  readonly signed: boolean;
  readonly verbose: boolean;
  readonly mockUpdates: boolean;
  readonly mockUpdateServerPort: string | undefined;
}

interface StagePackageJson {
  readonly name: string;
  readonly version: string;
  readonly buildVersion: string;
  readonly agentscienceCommitHash: string;
  readonly private: true;
  readonly description: string;
  readonly author: string;
  readonly main: string;
  readonly build: Record<string, unknown>;
  readonly dependencies: Record<string, unknown>;
  readonly devDependencies: {
    readonly electron: string;
  };
}

const AzureTrustedSigningOptionsConfig = Config.all({
  publisherName: Config.string("AZURE_TRUSTED_SIGNING_PUBLISHER_NAME"),
  endpoint: Config.string("AZURE_TRUSTED_SIGNING_ENDPOINT"),
  certificateProfileName: Config.string("AZURE_TRUSTED_SIGNING_CERTIFICATE_PROFILE_NAME"),
  codeSigningAccountName: Config.string("AZURE_TRUSTED_SIGNING_ACCOUNT_NAME"),
  fileDigest: Config.string("AZURE_TRUSTED_SIGNING_FILE_DIGEST").pipe(Config.withDefault("SHA256")),
  timestampDigest: Config.string("AZURE_TRUSTED_SIGNING_TIMESTAMP_DIGEST").pipe(
    Config.withDefault("SHA256"),
  ),
  timestampRfc3161: Config.string("AZURE_TRUSTED_SIGNING_TIMESTAMP_RFC3161").pipe(
    Config.withDefault("http://timestamp.acs.microsoft.com"),
  ),
});

const BuildEnvConfig = Config.all({
  platform: Config.schema(BuildPlatform, "AGENTSCIENCE_DESKTOP_PLATFORM").pipe(Config.option),
  target: Config.string("AGENTSCIENCE_DESKTOP_TARGET").pipe(Config.option),
  arch: Config.schema(BuildArch, "AGENTSCIENCE_DESKTOP_ARCH").pipe(Config.option),
  version: Config.string("AGENTSCIENCE_DESKTOP_VERSION").pipe(Config.option),
  outputDir: Config.string("AGENTSCIENCE_DESKTOP_OUTPUT_DIR").pipe(Config.option),
  skipBuild: Config.boolean("AGENTSCIENCE_DESKTOP_SKIP_BUILD").pipe(Config.withDefault(false)),
  keepStage: Config.boolean("AGENTSCIENCE_DESKTOP_KEEP_STAGE").pipe(Config.withDefault(false)),
  signed: Config.boolean("AGENTSCIENCE_DESKTOP_SIGNED").pipe(Config.withDefault(false)),
  verbose: Config.boolean("AGENTSCIENCE_DESKTOP_VERBOSE").pipe(Config.withDefault(false)),
  mockUpdates: Config.boolean("AGENTSCIENCE_DESKTOP_MOCK_UPDATES").pipe(Config.withDefault(false)),
  mockUpdateServerPort: Config.string("AGENTSCIENCE_DESKTOP_MOCK_UPDATE_SERVER_PORT").pipe(
    Config.option,
  ),
});

const resolveBooleanFlag = (flag: Option.Option<boolean>, envValue: boolean) =>
  Option.getOrElse(Option.filter(flag, Boolean), () => envValue);
const mergeOptions = <A>(a: Option.Option<A>, b: Option.Option<A>, defaultValue: A) =>
  Option.getOrElse(a, () => Option.getOrElse(b, () => defaultValue));

const resolveBuildOptions = Effect.fn("resolveBuildOptions")(function* (input: BuildCliInput) {
  const path = yield* Path.Path;
  const repoRoot = yield* RepoRoot;
  const env = yield* BuildEnvConfig.asEffect();

  const platform = mergeOptions(
    input.platform,
    env.platform,
    detectHostBuildPlatform(process.platform),
  );

  if (!platform) {
    return yield* new BuildScriptError({
      message: `Unsupported host platform '${process.platform}'.`,
    });
  }

  const target = mergeOptions(input.target, env.target, PLATFORM_CONFIG[platform].defaultTarget);
  const arch = mergeOptions(input.arch, env.arch, getDefaultArch(platform));
  const version = mergeOptions(input.buildVersion, env.version, undefined);
  const releaseDir = resolveBooleanFlag(input.mockUpdates, env.mockUpdates)
    ? "release-mock"
    : "release";
  const outputDir = path.resolve(
    repoRoot,
    mergeOptions(input.outputDir, env.outputDir, releaseDir),
  );

  const skipBuild = resolveBooleanFlag(input.skipBuild, env.skipBuild);
  const keepStage = resolveBooleanFlag(input.keepStage, env.keepStage);
  const signed = resolveBooleanFlag(input.signed, env.signed);
  const verbose = resolveBooleanFlag(input.verbose, env.verbose);

  const mockUpdates = resolveBooleanFlag(input.mockUpdates, env.mockUpdates);
  const mockUpdateServerPort = mergeOptions(
    input.mockUpdateServerPort,
    env.mockUpdateServerPort,
    undefined,
  );

  return {
    platform,
    target,
    arch,
    version,
    outputDir,
    skipBuild,
    keepStage,
    signed,
    verbose,
    mockUpdates,
    mockUpdateServerPort,
  } satisfies ResolvedBuildOptions;
});

const commandOutputOptions = (verbose: boolean) =>
  ({
    stdout: verbose ? "inherit" : "ignore",
    stderr: "inherit",
  }) as const;

const AFTER_PACK_HOOK_FILE = "electron-builder-after-pack.mjs";
const MAC_APP_ICON_PNG_FILE = "app-icon.png";
const MAC_APP_ICON_ICNS_FILE = "app-icon.icns";
const SOURCE_MAP_SUFFIXES = [
  ".js.map",
  ".cjs.map",
  ".mjs.map",
  ".css.map",
  ".d.ts.map",
  ".d.mts.map",
  ".d.cts.map",
] as const;
const TYPE_DECLARATION_SUFFIXES = [".d.ts", ".d.mts", ".d.cts"] as const;
const DEBUG_SYMBOL_SUFFIXES = [".pdb"] as const;
const NODE_PTY_BUILD_ONLY_ENTRIES = [
  "binding.gyp",
  "deps",
  "scripts",
  "src",
  "third_party",
  "typings",
] as const;
const KNOWN_RUNTIME_DIST_ONLY_SOURCE_TREES = [
  ["node_modules", "effect", "src"],
  ["node_modules", "@effect", "platform-node", "src"],
  ["node_modules", "@effect", "platform-bun", "src"],
  ["node_modules", "@effect", "platform-node-shared", "src"],
  ["node_modules", "@effect", "sql-sqlite-bun", "src"],
] as const;

const runCommand = Effect.fn("runCommand")(function* (command: ChildProcess.Command) {
  const commandSpawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const child = yield* commandSpawner.spawn(command);
  const exitCode = yield* child.exitCode;

  if (exitCode !== 0) {
    return yield* new BuildScriptError({
      message: `Command exited with non-zero exit code (${exitCode})`,
    });
  }
});

function generateMacIconSet(
  sourcePng: string,
  targetIcns: string,
  tmpRoot: string,
  path: Path.Path,
  verbose: boolean,
) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const iconsetDir = path.join(tmpRoot, "icon.iconset");
    yield* fs.makeDirectory(iconsetDir, { recursive: true });

    const iconSizes = [16, 32, 128, 256, 512] as const;
    for (const size of iconSizes) {
      yield* runCommand(
        ChildProcess.make({
          ...commandOutputOptions(verbose),
        })`sips -z ${size} ${size} ${sourcePng} --out ${path.join(iconsetDir, `icon_${size}x${size}.png`)}`,
      );

      const retinaSize = size * 2;
      yield* runCommand(
        ChildProcess.make({
          ...commandOutputOptions(verbose),
        })`sips -z ${retinaSize} ${retinaSize} ${sourcePng} --out ${path.join(iconsetDir, `icon_${size}x${size}@2x.png`)}`,
      );
    }

    yield* runCommand(
      ChildProcess.make({
        ...commandOutputOptions(verbose),
      })`iconutil -c icns ${iconsetDir} -o ${targetIcns}`,
    );
  });
}

function stageMacIcons(stageResourcesDir: string, verbose: boolean) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const iconSource = yield* ProductionMacIconSource;
    if (!(yield* fs.exists(iconSource))) {
      return yield* new BuildScriptError({
        message: `Production icon source is missing at ${iconSource}`,
      });
    }

    const tmpRoot = yield* fs.makeTempDirectoryScoped({
      prefix: "agentscience-icon-build-",
    });

    const iconPngPath = path.join(stageResourcesDir, MAC_APP_ICON_PNG_FILE);
    const iconIcnsPath = path.join(stageResourcesDir, MAC_APP_ICON_ICNS_FILE);

    yield* runCommand(
      ChildProcess.make({
        ...commandOutputOptions(verbose),
      })`sips -z 512 512 ${iconSource} --out ${iconPngPath}`,
    );

    yield* fs.copyFile(iconPngPath, path.join(stageResourcesDir, "icon.png"));
    yield* generateMacIconSet(iconSource, iconIcnsPath, tmpRoot, path, verbose);
    yield* fs.copyFile(iconIcnsPath, path.join(stageResourcesDir, "icon.icns"));
  });
}

function stageLinuxIcons(stageResourcesDir: string) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const iconSource = yield* ProductionLinuxIconSource;
    if (!(yield* fs.exists(iconSource))) {
      return yield* new BuildScriptError({
        message: `Production icon source is missing at ${iconSource}`,
      });
    }

    const iconPath = path.join(stageResourcesDir, "icon.png");
    yield* fs.copyFile(iconSource, iconPath);
  });
}

function stageWindowsIcons(stageResourcesDir: string) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const iconSource = yield* ProductionWindowsIconSource;
    if (!(yield* fs.exists(iconSource))) {
      return yield* new BuildScriptError({
        message: `Production Windows icon source is missing at ${iconSource}`,
      });
    }

    const iconPath = path.join(stageResourcesDir, "icon.ico");
    yield* fs.copyFile(iconSource, iconPath);
  });
}

function validateBundledClientAssets(clientDir: string) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const indexPath = path.join(clientDir, "index.html");
    const indexHtml = yield* fs.readFileString(indexPath);
    const refs = [...indexHtml.matchAll(/\b(?:src|href)=["']([^"']+)["']/g)]
      .map((match) => match[1])
      .filter((value): value is string => value !== undefined);
    const missing: string[] = [];

    for (const ref of refs) {
      const normalizedRef = ref.split("#")[0]?.split("?")[0] ?? "";
      if (!normalizedRef) continue;
      if (normalizedRef.startsWith("http://") || normalizedRef.startsWith("https://")) continue;
      if (normalizedRef.startsWith("data:") || normalizedRef.startsWith("mailto:")) continue;

      const ext = path.extname(normalizedRef);
      if (!ext) continue;

      const relativePath = normalizedRef.replace(/^\/+/, "");
      const assetPath = path.join(clientDir, relativePath);
      if (!(yield* fs.exists(assetPath))) {
        missing.push(normalizedRef);
      }
    }

    if (missing.length > 0) {
      const preview = missing.slice(0, 6).join(", ");
      const suffix = missing.length > 6 ? ` (+${missing.length - 6} more)` : "";
      return yield* new BuildScriptError({
        message: `Bundled client references missing files in ${indexPath}: ${preview}${suffix}. Rebuild web/server artifacts.`,
      });
    }
  });
}

function pathHasAnySuffix(pathname: string, suffixes: ReadonlyArray<string>): boolean {
  return suffixes.some((suffix) => pathname.endsWith(suffix));
}

const removeFilesBySuffixes = Effect.fn("removeFilesBySuffixes")(function* (
  rootDir: string,
  suffixes: ReadonlyArray<string>,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  if (!(yield* fs.exists(rootDir))) {
    return;
  }

  const stack = [rootDir];
  while (stack.length > 0) {
    const currentDir = stack.pop();
    if (!currentDir) {
      continue;
    }

    const entries = yield* fs
      .readDirectory(currentDir, { recursive: false })
      .pipe(Effect.catch(() => Effect.succeed([] as Array<string>)));

    for (const entry of entries) {
      const entryPath = path.join(currentDir, entry);
      const stat = yield* fs.stat(entryPath).pipe(Effect.catch(() => Effect.succeed(null)));
      if (!stat) {
        continue;
      }

      if (stat.type === "Directory") {
        stack.push(entryPath);
        continue;
      }

      if (pathHasAnySuffix(entryPath, suffixes)) {
        yield* fs.remove(entryPath, { force: true });
      }
    }
  }
});

const prunePackagedSourceMaps = Effect.fn("prunePackagedSourceMaps")(function* (stageAppDir: string) {
  yield* removeFilesBySuffixes(stageAppDir, SOURCE_MAP_SUFFIXES);
});

const prunePackagedTypeDeclarations = Effect.fn("prunePackagedTypeDeclarations")(function* (
  stageAppDir: string,
) {
  yield* removeFilesBySuffixes(stageAppDir, TYPE_DECLARATION_SUFFIXES);
});

const prunePackagedDebugSymbols = Effect.fn("prunePackagedDebugSymbols")(function* (
  stageAppDir: string,
) {
  yield* removeFilesBySuffixes(stageAppDir, DEBUG_SYMBOL_SUFFIXES);
});

const pruneKnownPackageSourceTrees = Effect.fn("pruneKnownPackageSourceTrees")(function* (
  stageAppDir: string,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  for (const relativeSegments of KNOWN_RUNTIME_DIST_ONLY_SOURCE_TREES) {
    yield* fs.remove(path.join(stageAppDir, ...relativeSegments), {
      recursive: true,
      force: true,
    }).pipe(Effect.ignore);
  }
});

function resolveDesktopRuntimeDependencies(
  dependencies: Record<string, unknown> | undefined,
  catalog: Record<string, unknown>,
): Record<string, unknown> {
  if (!dependencies || Object.keys(dependencies).length === 0) {
    return {};
  }

  const runtimeDependencies = Object.fromEntries(
    Object.entries(dependencies).filter(([dependencyName]) => dependencyName !== "electron"),
  );

  return resolveCatalogDependencies(runtimeDependencies, catalog, "apps/desktop");
}

function addPackagedDependencyPins(dependencies: Record<string, unknown>): Record<string, unknown> {
  return {
    ...dependencies,
    ...PACKAGED_PINNED_DEPENDENCIES,
  };
}

function resolveManagedCodexVersion(): string {
  const configuredVersion = desktopPackageJson.dependencies["@openai/codex"];
  if (typeof configuredVersion !== "string" || configuredVersion.trim().length === 0) {
    throw new Error("apps/desktop/package.json is missing the @openai/codex dependency.");
  }

  return configuredVersion.trim().replace(/^[~^]/, "");
}

function resolveManagedCodexTargets(
  platform: typeof BuildPlatform.Type,
  arch: typeof BuildArch.Type,
): ReadonlyArray<ManagedCodexTarget> {
  if (platform === "mac") {
    if (arch === "arm64") {
      return [
        {
          packageName: "@openai/codex-darwin-arm64",
          packageVersionSuffix: "darwin-arm64",
          targetTriple: "aarch64-apple-darwin",
        },
      ];
    }

    if (arch === "x64") {
      return [
        {
          packageName: "@openai/codex-darwin-x64",
          packageVersionSuffix: "darwin-x64",
          targetTriple: "x86_64-apple-darwin",
        },
      ];
    }

    return [
      {
        packageName: "@openai/codex-darwin-arm64",
        packageVersionSuffix: "darwin-arm64",
        targetTriple: "aarch64-apple-darwin",
      },
      {
        packageName: "@openai/codex-darwin-x64",
        packageVersionSuffix: "darwin-x64",
        targetTriple: "x86_64-apple-darwin",
      },
    ];
  }

  if (platform === "linux") {
    return arch === "arm64"
      ? [
          {
            packageName: "@openai/codex-linux-arm64",
            packageVersionSuffix: "linux-arm64",
            targetTriple: "aarch64-unknown-linux-musl",
          },
        ]
      : [
          {
            packageName: "@openai/codex-linux-x64",
            packageVersionSuffix: "linux-x64",
            targetTriple: "x86_64-unknown-linux-musl",
          },
        ];
  }

  return arch === "arm64"
    ? [
        {
          packageName: "@openai/codex-win32-arm64",
          packageVersionSuffix: "win32-arm64",
          targetTriple: "aarch64-pc-windows-msvc",
        },
      ]
    : [
        {
          packageName: "@openai/codex-win32-x64",
          packageVersionSuffix: "win32-x64",
          targetTriple: "x86_64-pc-windows-msvc",
        },
      ];
}

function resolveManagedCodexDependencies(
  platform: typeof BuildPlatform.Type,
  arch: typeof BuildArch.Type,
): Record<string, string> {
  const version = resolveManagedCodexVersion();

  return Object.fromEntries(
    resolveManagedCodexTargets(platform, arch).map((target) => [
      target.packageName,
      `npm:@openai/codex@${version}-${target.packageVersionSuffix}`,
    ]),
  );
}

function toBunInstallTargetOs(platform: typeof BuildPlatform.Type): "darwin" | "linux" | "win32" {
  switch (platform) {
    case "mac":
      return "darwin";
    case "linux":
      return "linux";
    case "win":
      return "win32";
  }
}

function toBunInstallTargetCpu(arch: typeof BuildArch.Type): "arm64" | "x64" | "*" {
  switch (arch) {
    case "arm64":
      return "arm64";
    case "x64":
      return "x64";
    case "universal":
      return "*";
  }
}

function resolveGitHubPublishConfig():
  | {
      readonly provider: "github";
      readonly owner: string;
      readonly repo: string;
      readonly releaseType: "release";
    }
  | undefined {
  const rawRepo =
    process.env.AGENTSCIENCE_DESKTOP_UPDATE_REPOSITORY?.trim() ||
    process.env.GITHUB_REPOSITORY?.trim() ||
    "";
  if (!rawRepo) return undefined;

  const [owner, repo, ...rest] = rawRepo.split("/");
  if (!owner || !repo || rest.length > 0) return undefined;

  return {
    provider: "github",
    owner,
    repo,
    releaseType: "release",
  };
}

const createBuildConfig = Effect.fn("createBuildConfig")(function* (
  platform: typeof BuildPlatform.Type,
  target: string,
  productName: string,
  signed: boolean,
  mockUpdates: boolean,
  mockUpdateServerPort: string | undefined,
) {
  const buildConfig: Record<string, unknown> = {
    appId: "com.agentscience.app",
    productName,
    artifactName: "Agent-Science-${version}-${arch}.${ext}",
    directories: {
      buildResources: "apps/desktop/resources",
    },
    extraResources: [
      {
        from: "apps/desktop/managed-resources",
        to: "managed-resources",
      },
    ],
  };
  const publishConfig = resolveGitHubPublishConfig();
  if (publishConfig) {
    buildConfig.publish = [publishConfig];
  } else if (mockUpdates) {
    buildConfig.publish = [
      {
        provider: "generic",
        url: `http://localhost:${mockUpdateServerPort ?? 3000}`,
      },
    ];
  }

  if (platform === "mac") {
    buildConfig.afterPack = AFTER_PACK_HOOK_FILE;
    buildConfig.mac = {
      target: target === "dmg" ? [target, "zip"] : [target],
      icon: MAC_APP_ICON_ICNS_FILE,
      category: "public.app-category.developer-tools",
    };
  }

  if (platform === "linux") {
    buildConfig.linux = {
      target: [target],
      executableName: "agentscience",
      icon: "icon.png",
      category: "Development",
      desktop: {
        entry: {
          StartupWMClass: "agentscience",
        },
      },
    };
  }

  if (platform === "win") {
    const winConfig: Record<string, unknown> = {
      target: [target],
      icon: "icon.ico",
    };
    if (signed) {
      winConfig.azureSignOptions = yield* AzureTrustedSigningOptionsConfig;
    }
    buildConfig.win = winConfig;
  }

  return buildConfig;
});

const pruneManagedCodexInstallArtifacts = Effect.fn("pruneManagedCodexInstallArtifacts")(function* (
  stageAppDir: string,
  platform: typeof BuildPlatform.Type,
  arch: typeof BuildArch.Type,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  for (const target of resolveManagedCodexTargets(platform, arch)) {
    const installedVendorDir = path.join(
      stageAppDir,
      "node_modules",
      ...target.packageName.split("/"),
      "vendor",
    );
    yield* fs.remove(installedVendorDir, { recursive: true, force: true }).pipe(Effect.ignore);
  }
});

function resolveNodePtyPrebuildTargets(
  platform: typeof BuildPlatform.Type,
  arch: typeof BuildArch.Type,
): ReadonlyArray<string> {
  if (platform === "mac") {
    if (arch === "arm64") return ["darwin-arm64"];
    if (arch === "x64") return ["darwin-x64"];
    return ["darwin-arm64", "darwin-x64"];
  }

  if (platform === "linux") {
    return arch === "arm64" ? ["linux-arm64"] : ["linux-x64"];
  }

  return arch === "arm64" ? ["win32-arm64"] : ["win32-x64"];
}

const pruneNodePtyInstallArtifacts = Effect.fn("pruneNodePtyInstallArtifacts")(function* (
  stageAppDir: string,
  platform: typeof BuildPlatform.Type,
  arch: typeof BuildArch.Type,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const nodePtyRoot = path.join(stageAppDir, "node_modules", "node-pty");
  if (!(yield* fs.exists(nodePtyRoot))) {
    return;
  }

  const prebuildsDir = path.join(nodePtyRoot, "prebuilds");
  if (yield* fs.exists(prebuildsDir)) {
    const allowedPrebuildTargets = new Set(resolveNodePtyPrebuildTargets(platform, arch));
    const prebuildDirs = yield* fs
      .readDirectory(prebuildsDir, { recursive: false })
      .pipe(Effect.catch(() => Effect.succeed([] as Array<string>)));

    for (const entry of prebuildDirs) {
      if (allowedPrebuildTargets.has(entry)) {
        continue;
      }
      yield* fs.remove(path.join(prebuildsDir, entry), {
        recursive: true,
        force: true,
      }).pipe(Effect.ignore);
    }

    yield* removeFilesBySuffixes(prebuildsDir, DEBUG_SYMBOL_SUFFIXES);
  }

  for (const entry of NODE_PTY_BUILD_ONLY_ENTRIES) {
    yield* fs.remove(path.join(nodePtyRoot, entry), {
      recursive: true,
      force: true,
    }).pipe(Effect.ignore);
  }
});

const assertPlatformBuildResources = Effect.fn("assertPlatformBuildResources")(function* (
  platform: typeof BuildPlatform.Type,
  stageResourcesDir: string,
  verbose: boolean,
) {
  if (platform === "mac") {
    yield* stageMacIcons(stageResourcesDir, verbose);
    return;
  }

  if (platform === "linux") {
    yield* stageLinuxIcons(stageResourcesDir);
    return;
  }

  if (platform === "win") {
    yield* stageWindowsIcons(stageResourcesDir);
  }
});

const buildDesktopArtifact = Effect.fn("buildDesktopArtifact")(function* (
  options: ResolvedBuildOptions,
) {
  const repoRoot = yield* RepoRoot;
  const path = yield* Path.Path;
  const fs = yield* FileSystem.FileSystem;

  const platformConfig = PLATFORM_CONFIG[options.platform];
  if (!platformConfig) {
    return yield* new BuildScriptError({
      message: `Unsupported platform '${options.platform}'.`,
    });
  }

  const electronVersion = desktopPackageJson.dependencies.electron;

  const serverDependencies = serverPackageJson.dependencies;
  if (!serverDependencies || Object.keys(serverDependencies).length === 0) {
    return yield* new BuildScriptError({
      message: "Could not resolve production dependencies from apps/server/package.json.",
    });
  }

  const resolvedServerDependencies = yield* Effect.try({
    try: () =>
      resolveCatalogDependencies(
        serverDependencies,
        rootPackageJson.workspaces.catalog,
        "apps/server",
      ),
    catch: (cause) =>
      new BuildScriptError({
        message: "Could not resolve production dependencies from apps/server/package.json.",
        cause,
      }),
  });
  const resolvedDesktopRuntimeDependencies = yield* Effect.try({
    try: () =>
      resolveDesktopRuntimeDependencies(
        desktopPackageJson.dependencies,
        rootPackageJson.workspaces.catalog,
      ),
    catch: (cause) =>
      new BuildScriptError({
        message: "Could not resolve desktop runtime dependencies from apps/desktop/package.json.",
        cause,
      }),
  });

  const appVersion = options.version ?? serverPackageJson.version;
  const commitHash = resolveGitCommitHash(repoRoot);
  const mkdir = options.keepStage ? fs.makeTempDirectory : fs.makeTempDirectoryScoped;
  const stageRoot = yield* mkdir({
    prefix: `agentscience-desktop-${options.platform}-stage-`,
  });

  const stageAppDir = path.join(stageRoot, "app");
  const stageResourcesDir = path.join(stageAppDir, "apps/desktop/resources");
  const stageManagedResourcesDir = path.join(stageAppDir, "apps/desktop/managed-resources");
  const distDirs = {
    desktopDist: path.join(repoRoot, "apps/desktop/dist-electron"),
    desktopResources: path.join(repoRoot, "apps/desktop/resources"),
    serverDist: path.join(repoRoot, "apps/server/dist"),
  };
  const bundledClientEntry = path.join(distDirs.serverDist, "client/index.html");

  if (!options.skipBuild) {
    yield* Effect.log("[desktop-artifact] Building desktop/server/web artifacts...");
    yield* runCommand(
      ChildProcess.make({
        cwd: repoRoot,
        env: {
          ...process.env,
          AGENTSCIENCE_DESKTOP_SOURCEMAP: "0",
          AGENTSCIENCE_SERVER_SOURCEMAP: "0",
          AGENTSCIENCE_WEB_SOURCEMAP: "0",
        },
        ...commandOutputOptions(options.verbose),
        // Windows needs shell mode to resolve .cmd shims (e.g. bun.cmd).
        shell: process.platform === "win32",
      })`bun run build:desktop -- --force`,
    );
  }

  for (const [label, dir] of Object.entries(distDirs)) {
    if (!(yield* fs.exists(dir))) {
      return yield* new BuildScriptError({
        message: `Missing ${label} at ${dir}. Run 'bun run build:desktop' first.`,
      });
    }
  }

  if (!(yield* fs.exists(bundledClientEntry))) {
    return yield* new BuildScriptError({
      message: `Missing bundled server client at ${bundledClientEntry}. Run 'bun run build:desktop' first.`,
    });
  }

  yield* validateBundledClientAssets(path.dirname(bundledClientEntry));

  yield* fs.makeDirectory(path.join(stageAppDir, "apps/desktop"), { recursive: true });
  yield* fs.makeDirectory(path.join(stageAppDir, "apps/server"), { recursive: true });
  yield* fs.makeDirectory(stageManagedResourcesDir, { recursive: true });

  yield* Effect.log("[desktop-artifact] Staging release app...");
  yield* fs.copy(distDirs.desktopDist, path.join(stageAppDir, "apps/desktop/dist-electron"));
  yield* fs.copy(distDirs.desktopResources, stageResourcesDir);
  yield* fs.copy(distDirs.serverDist, path.join(stageAppDir, "apps/server/dist"));

  yield* assertPlatformBuildResources(options.platform, stageResourcesDir, options.verbose);

  // electron-builder is filtering out stageResourcesDir directory in the AppImage for production
  yield* fs.copy(stageResourcesDir, path.join(stageAppDir, "apps/desktop/prod-resources"));

  const stagePackageJson: StagePackageJson = {
    name: "agentscience",
    version: appVersion,
    buildVersion: appVersion,
    agentscienceCommitHash: commitHash,
    private: true,
    description: "AgentScience desktop build",
    author: "AgentScience",
    main: "apps/desktop/dist-electron/main.js",
    build: yield* createBuildConfig(
      options.platform,
      options.target,
      desktopPackageJson.productName ?? "AgentScience",
      options.signed,
      options.mockUpdates,
      options.mockUpdateServerPort,
    ),
    dependencies: addPackagedDependencyPins({
      ...resolvedServerDependencies,
      ...resolvedDesktopRuntimeDependencies,
      ...resolveManagedCodexDependencies(options.platform, options.arch),
    }),
    devDependencies: {
      electron: electronVersion,
    },
  };

  const stagePackageJsonString = yield* encodeJsonString(stagePackageJson);
  yield* fs.writeFileString(path.join(stageAppDir, "package.json"), `${stagePackageJsonString}\n`);
  yield* fs.copyFile(
    path.join(repoRoot, "scripts", AFTER_PACK_HOOK_FILE),
    path.join(stageAppDir, AFTER_PACK_HOOK_FILE),
  );

  yield* Effect.log("[desktop-artifact] Installing staged production dependencies...");
  const bunInstallTargetOs = toBunInstallTargetOs(options.platform);
  const bunInstallTargetCpu = toBunInstallTargetCpu(options.arch);
  yield* runCommand(
    ChildProcess.make({
      cwd: stageAppDir,
      ...commandOutputOptions(options.verbose),
      // Windows needs shell mode to resolve .cmd shims (e.g. bun.cmd).
      shell: process.platform === "win32",
    })`bun install --production --os ${bunInstallTargetOs} --cpu ${bunInstallTargetCpu}`,
  );

  yield* Effect.log("[desktop-artifact] Pruning packaged source maps...");
  yield* prunePackagedSourceMaps(stageAppDir);
  yield* Effect.log("[desktop-artifact] Pruning packaged type declarations...");
  yield* prunePackagedTypeDeclarations(stageAppDir);
  yield* Effect.log("[desktop-artifact] Pruning packaged source-only dependency trees...");
  yield* pruneKnownPackageSourceTrees(stageAppDir);
  yield* Effect.log("[desktop-artifact] Pruning packaged debug symbols...");
  yield* prunePackagedDebugSymbols(stageAppDir);

  yield* bundleManagedCodexRuntime(
    stageAppDir,
    stageManagedResourcesDir,
    options.platform,
    options.arch,
  );

  yield* Effect.log("[desktop-artifact] Removing duplicated managed Codex install payloads...");
  yield* pruneManagedCodexInstallArtifacts(stageAppDir, options.platform, options.arch);
  yield* Effect.log("[desktop-artifact] Trimming node-pty install payload...");
  yield* pruneNodePtyInstallArtifacts(stageAppDir, options.platform, options.arch);

  const buildEnv: NodeJS.ProcessEnv = {
    ...process.env,
  };
  for (const [key, value] of Object.entries(buildEnv)) {
    if (value === "") {
      delete buildEnv[key];
    }
  }
  if (!options.signed) {
    buildEnv.CSC_IDENTITY_AUTO_DISCOVERY = "false";
    delete buildEnv.CSC_LINK;
    delete buildEnv.CSC_KEY_PASSWORD;
    delete buildEnv.APPLE_API_KEY;
    delete buildEnv.APPLE_API_KEY_ID;
    delete buildEnv.APPLE_API_ISSUER;
  }

  if (process.platform === "win32") {
    const python = resolvePythonForNodeGyp();
    if (python) {
      buildEnv.PYTHON = python;
      buildEnv.npm_config_python = python;
    }
    buildEnv.npm_config_msvs_version = buildEnv.npm_config_msvs_version ?? "2022";
    buildEnv.GYP_MSVS_VERSION = buildEnv.GYP_MSVS_VERSION ?? "2022";
  }

  yield* Effect.log(
    `[desktop-artifact] Building ${options.platform}/${options.target} (arch=${options.arch}, version=${appVersion})...`,
  );
  yield* runCommand(
    ChildProcess.make({
      cwd: stageAppDir,
      env: buildEnv,
      ...commandOutputOptions(options.verbose),
      // Windows needs shell mode to resolve .cmd shims.
      shell: process.platform === "win32",
    })`bunx electron-builder ${platformConfig.cliFlag} --${options.arch} --publish never`,
  );

  const stageDistDir = path.join(stageAppDir, "dist");
  if (!(yield* fs.exists(stageDistDir))) {
    return yield* new BuildScriptError({
      message: `Build completed but dist directory was not found at ${stageDistDir}`,
    });
  }

  const stageEntries = yield* fs.readDirectory(stageDistDir);
  yield* fs.makeDirectory(options.outputDir, { recursive: true });

  const copiedArtifacts: string[] = [];
  for (const entry of stageEntries) {
    const from = path.join(stageDistDir, entry);
    const stat = yield* fs.stat(from).pipe(Effect.catch(() => Effect.succeed(null)));
    if (!stat || stat.type !== "File") continue;

    const to = path.join(options.outputDir, entry);
    yield* fs.copyFile(from, to);
    copiedArtifacts.push(to);
  }

  if (copiedArtifacts.length === 0) {
    return yield* new BuildScriptError({
      message: `Build completed but no files were produced in ${stageDistDir}`,
    });
  }

  yield* Effect.log("[desktop-artifact] Done. Artifacts:").pipe(
    Effect.annotateLogs({ artifacts: copiedArtifacts }),
  );
});

const bundleManagedCodexRuntime = Effect.fn("bundleManagedCodexRuntime")(function* (
  stageAppDir: string,
  stageManagedResourcesDir: string,
  platform: typeof BuildPlatform.Type,
  arch: typeof BuildArch.Type,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const runtimeRoot = path.join(stageManagedResourcesDir, MANAGED_CODEX_RESOURCE_DIR);

  yield* fs.makeDirectory(runtimeRoot, { recursive: true });

  for (const target of resolveManagedCodexTargets(platform, arch)) {
    const sourceDir = path.join(
      stageAppDir,
      "node_modules",
      ...target.packageName.split("/"),
      "vendor",
      target.targetTriple,
    );
    const codexBinaryDir = path.join(sourceDir, "codex");
    const rgDir = path.join(sourceDir, "path");

    if (!(yield* fs.exists(codexBinaryDir))) {
      return yield* new BuildScriptError({
        message: `Missing Codex runtime payload for ${target.packageName} at ${codexBinaryDir}.`,
      });
    }
    if (!(yield* fs.exists(rgDir))) {
      return yield* new BuildScriptError({
        message: `Missing Codex runtime PATH payload for ${target.packageName} at ${rgDir}.`,
      });
    }

    yield* fs.copy(sourceDir, path.join(runtimeRoot, target.targetTriple));
  }
});

const buildDesktopArtifactCli = Command.make("build-desktop-artifact", {
  platform: Flag.choice("platform", BuildPlatform.literals).pipe(
    Flag.withDescription("Build platform (env: AGENTSCIENCE_DESKTOP_PLATFORM)."),
    Flag.optional,
  ),
  target: Flag.string("target").pipe(
    Flag.withDescription(
      "Artifact target, for example dmg/AppImage/nsis (env: AGENTSCIENCE_DESKTOP_TARGET).",
    ),
    Flag.optional,
  ),
  arch: Flag.choice("arch", BuildArch.literals).pipe(
    Flag.withDescription(
      "Build arch, for example arm64/x64/universal (env: AGENTSCIENCE_DESKTOP_ARCH).",
    ),
    Flag.optional,
  ),
  buildVersion: Flag.string("build-version").pipe(
    Flag.withDescription("Artifact version metadata (env: AGENTSCIENCE_DESKTOP_VERSION)."),
    Flag.optional,
  ),
  outputDir: Flag.string("output-dir").pipe(
    Flag.withDescription("Output directory for artifacts (env: AGENTSCIENCE_DESKTOP_OUTPUT_DIR)."),
    Flag.optional,
  ),
  skipBuild: Flag.boolean("skip-build").pipe(
    Flag.withDescription(
      "Skip `bun run build:desktop` and use existing dist artifacts (env: AGENTSCIENCE_DESKTOP_SKIP_BUILD).",
    ),
    Flag.optional,
  ),
  keepStage: Flag.boolean("keep-stage").pipe(
    Flag.withDescription("Keep temporary staging files (env: AGENTSCIENCE_DESKTOP_KEEP_STAGE)."),
    Flag.optional,
  ),
  signed: Flag.boolean("signed").pipe(
    Flag.withDescription(
      "Enable signing/notarization discovery; Windows uses Azure Trusted Signing (env: AGENTSCIENCE_DESKTOP_SIGNED).",
    ),
    Flag.optional,
  ),
  verbose: Flag.boolean("verbose").pipe(
    Flag.withDescription("Stream subprocess stdout (env: AGENTSCIENCE_DESKTOP_VERBOSE)."),
    Flag.optional,
  ),
  mockUpdates: Flag.boolean("mock-updates").pipe(
    Flag.withDescription("Enable mock updates (env: AGENTSCIENCE_DESKTOP_MOCK_UPDATES)."),
    Flag.optional,
  ),
  mockUpdateServerPort: Flag.string("mock-update-server-port").pipe(
    Flag.withDescription(
      "Mock update server port (env: AGENTSCIENCE_DESKTOP_MOCK_UPDATE_SERVER_PORT).",
    ),
    Flag.optional,
  ),
}).pipe(
  Command.withDescription("Build a desktop artifact for AgentScience."),
  Command.withHandler((input) => Effect.flatMap(resolveBuildOptions(input), buildDesktopArtifact)),
);

const cliRuntimeLayer = Layer.mergeAll(Logger.layer([Logger.consolePretty()]), NodeServices.layer);

Command.run(buildDesktopArtifactCli, { version: "0.0.0" }).pipe(
  Effect.scoped,
  Effect.provide(cliRuntimeLayer),
  NodeRuntime.runMain,
);
