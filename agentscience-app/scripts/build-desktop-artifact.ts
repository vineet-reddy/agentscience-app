#!/usr/bin/env node

import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
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
const DESKTOP_RELEASE_REPOSITORY = {
  owner: "vineet-reddy",
  repo: "agentscience-app",
} as const;
const PACKAGED_PINNED_DEPENDENCIES = {
  "@effect/platform-node-shared": "4.0.0-beta.43",
} as const;
const MANAGED_CODEX_RESOURCE_DIR = "codex-runtime";
const MANAGED_PAPER_TOOLCHAIN_RESOURCE_DIR = "paper-toolchain";
const MANAGED_SCIENCE_RUNTIME_RESOURCE_DIR = "science-runtime";
const MANAGED_PAPER_TOOLCHAIN_TECTONIC_VERSION = "0.16.9";
const MANAGED_SCIENCE_RUNTIME_PYTHON_BUILD_STANDALONE_TAG = "20260414";
const MANAGED_SCIENCE_RUNTIME_PYTHON_VERSION = "3.12.13";
const MANAGED_SCIENCE_RUNTIME_UV_VERSION = "0.11.7";
const MANAGED_SCIENCE_RUNTIME_PACKAGE_SPECS = [
  "numpy==2.4.4",
  "pandas==2.3.3",
  "matplotlib==3.10.7",
  "scipy==1.16.3",
  "scikit-learn==1.7.2",
  "seaborn==0.13.2",
  "statsmodels==0.14.5",
] as const;

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

interface ManagedScienceRuntimeTarget {
  readonly platformKey: string;
  readonly pythonTargetTriple: string;
  readonly uvTargetTriple: string;
}

interface ManagedPaperToolchainTarget {
  readonly platformKey: string;
  readonly tectonicArchiveName: string;
  readonly tectonicSha256: string;
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

function resolveManagedScienceRuntimeTargets(
  platform: typeof BuildPlatform.Type,
  arch: typeof BuildArch.Type,
): ReadonlyArray<ManagedScienceRuntimeTarget> {
  if (platform !== "mac") {
    return [];
  }

  if (arch === "arm64") {
    return [
      {
        platformKey: "darwin-arm64",
        pythonTargetTriple: "aarch64-apple-darwin",
        uvTargetTriple: "aarch64-apple-darwin",
      },
    ];
  }

  if (arch === "x64") {
    return [
      {
        platformKey: "darwin-x64",
        pythonTargetTriple: "x86_64-apple-darwin",
        uvTargetTriple: "x86_64-apple-darwin",
      },
    ];
  }

  return [
    {
      platformKey: "darwin-arm64",
      pythonTargetTriple: "aarch64-apple-darwin",
      uvTargetTriple: "aarch64-apple-darwin",
    },
    {
      platformKey: "darwin-x64",
      pythonTargetTriple: "x86_64-apple-darwin",
      uvTargetTriple: "x86_64-apple-darwin",
    },
  ];
}

function resolveManagedPaperToolchainTargets(
  platform: typeof BuildPlatform.Type,
  arch: typeof BuildArch.Type,
): ReadonlyArray<ManagedPaperToolchainTarget> {
  if (platform !== "mac") {
    return [];
  }

  if (arch === "arm64") {
    return [
      {
        platformKey: "darwin-arm64",
        tectonicArchiveName: `tectonic-${MANAGED_PAPER_TOOLCHAIN_TECTONIC_VERSION}-aarch64-apple-darwin.tar.gz`,
        tectonicSha256: "edb67c61aba768289f6da441c9e6f523cfaff4f8b2a5708523ef29c543f8e88e",
      },
    ];
  }

  if (arch === "x64") {
    return [
      {
        platformKey: "darwin-x64",
        tectonicArchiveName: `tectonic-${MANAGED_PAPER_TOOLCHAIN_TECTONIC_VERSION}-x86_64-apple-darwin.tar.gz`,
        tectonicSha256: "79d8839fa3594bfea9b2bf2ac0a0455bcc4d0de956a5e5c403107e9a72f79e86",
      },
    ];
  }

  return [
    {
      platformKey: "darwin-arm64",
      tectonicArchiveName: `tectonic-${MANAGED_PAPER_TOOLCHAIN_TECTONIC_VERSION}-aarch64-apple-darwin.tar.gz`,
      tectonicSha256: "edb67c61aba768289f6da441c9e6f523cfaff4f8b2a5708523ef29c543f8e88e",
    },
    {
      platformKey: "darwin-x64",
      tectonicArchiveName: `tectonic-${MANAGED_PAPER_TOOLCHAIN_TECTONIC_VERSION}-x86_64-apple-darwin.tar.gz`,
      tectonicSha256: "79d8839fa3594bfea9b2bf2ac0a0455bcc4d0de956a5e5c403107e9a72f79e86",
    },
  ];
}

function resolveManagedSciencePythonArchiveName(target: ManagedScienceRuntimeTarget): string {
  return `cpython-${MANAGED_SCIENCE_RUNTIME_PYTHON_VERSION}+${MANAGED_SCIENCE_RUNTIME_PYTHON_BUILD_STANDALONE_TAG}-${target.pythonTargetTriple}-install_only.tar.gz`;
}

function resolveManagedScienceUvArchiveName(target: ManagedScienceRuntimeTarget): string {
  return `uv-${target.uvTargetTriple}.tar.gz`;
}

function sha256File(filePath: string): string {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

function parseChecksumFileEntry(contents: string, filename: string): string {
  const escapedFilename = filename.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = contents.match(new RegExp(`^([a-f0-9]{64})\\s+\\*?${escapedFilename}$`, "im"));
  if (!match?.[1]) {
    throw new Error(`Could not find checksum for ${filename}.`);
  }
  return match[1].toLowerCase();
}

function assertSha256(filePath: string, expectedHash: string): void {
  const actualHash = sha256File(filePath);
  if (actualHash !== expectedHash.toLowerCase()) {
    throw new Error(`Checksum mismatch for ${filePath}: expected ${expectedHash}, got ${actualHash}.`);
  }
}

function runCheckedCommand(input: {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly verbose: boolean;
}): void {
  const result = spawnSync(input.command, [...input.args], {
    cwd: input.cwd,
    env: input.env,
    encoding: "utf8",
    stdio: input.verbose ? "inherit" : "pipe",
  });
  if (result.status === 0) {
    return;
  }

  const details = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
  throw new Error(
    `Command failed: ${input.command} ${input.args.join(" ")}${details ? `\n${details}` : ""}`,
  );
}

function buildManagedScienceRuntimeEnv(runtimeDir: string, cacheDir: string): NodeJS.ProcessEnv {
  const env = { ...process.env };
  const runtimeBinDir = join(runtimeDir, "bin");
  env.PATH = `${runtimeBinDir}:/usr/bin:/bin:/usr/sbin:/sbin`;
  env.PIP_DISABLE_PIP_VERSION_CHECK = "1";
  env.PIP_NO_INPUT = "1";
  env.PIP_CACHE_DIR = cacheDir;
  env.PYTHONHOME = runtimeDir;
  env.PYTHONNOUSERSITE = "1";
  delete env.PYTHONPATH;
  delete env.VIRTUAL_ENV;
  delete env.__PYVENV_LAUNCHER__;
  return env;
}

function writeExecutableScript(filePath: string, contents: string): void {
  writeFileSync(filePath, `${contents}\n`, { mode: 0o755 });
  chmodSync(filePath, 0o755);
}

function managedPaperCompileWrapperScript(): string {
  return [
    "#!/bin/sh",
    "set -eu",
    "",
    'SELF_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)',
    'TECTONIC="$SELF_DIR/tectonic"',
    "",
    'if [ ! -x "$TECTONIC" ]; then',
    '  echo "Missing bundled tectonic binary at $TECTONIC" >&2',
    "  exit 1",
    "fi",
    "",
    'outdir=""',
    'input=""',
    'while [ "$#" -gt 0 ]; do',
    '  case "$1" in',
    "    --version|-version|-v)",
    '      exec "$TECTONIC" --version',
    "      ;;",
    "    -output-directory=*|-outdir=*)",
    '      outdir=${1#*=}',
    "      ;;",
    "    -output-directory|-outdir)",
    "      shift",
    '      if [ "$#" -eq 0 ]; then',
    '        echo "Missing output directory." >&2',
    "        exit 2",
    "      fi",
    '      outdir="$1"',
    "      ;;",
    "    -interaction=*|-halt-on-error|-file-line-error|-pdf|-quiet|-cd|-f|-g|-shell-escape|-no-shell-escape|-recorder|-emulate-aux-dir|-aux-directory=*|-jobname=*|-synctex=*)",
    "      ;;",
    "    -*)",
    "      ;;",
    "    *)",
    '      if [ -z "$input" ]; then',
    '        input="$1"',
    "      fi",
    "      ;;",
    "  esac",
    "  shift",
    "done",
    "",
    'if [ -z "$input" ]; then',
    '  echo "No LaTeX source provided." >&2',
    "  exit 2",
    "fi",
    "",
    'if [ -n "$outdir" ]; then',
    '  exec "$TECTONIC" -X compile --keep-intermediates --keep-logs --outdir "$outdir" "$input"',
    "fi",
    "",
    'exec "$TECTONIC" -X compile --keep-intermediates --keep-logs "$input"',
  ].join("\n");
}

function managedPaperBibtexWrapperScript(): string {
  return [
    "#!/bin/sh",
    "set -eu",
    "",
    'SELF_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)',
    'TECTONIC="$SELF_DIR/tectonic"',
    "",
    'case "${1:-}" in',
    "  --version|-version|-v)",
    '    exec "$TECTONIC" --version',
    "    ;;",
    "esac",
    "",
    "# Tectonic already performs the necessary BibTeX passes during compile.",
    "exit 0",
  ].join("\n");
}

function stageManagedPaperToolchainShims(binDir: string): void {
  writeExecutableScript(join(binDir, "latexmk"), managedPaperCompileWrapperScript());
  writeExecutableScript(join(binDir, "pdflatex"), managedPaperCompileWrapperScript());
  writeExecutableScript(join(binDir, "bibtex"), managedPaperBibtexWrapperScript());
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
{
  return {
    provider: "github",
    owner: DESKTOP_RELEASE_REPOSITORY.owner,
    repo: DESKTOP_RELEASE_REPOSITORY.repo,
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
  if (mockUpdates) {
    buildConfig.publish = [
      {
        provider: "generic",
        url: `http://localhost:${mockUpdateServerPort ?? 3000}`,
      },
    ];
  } else {
    buildConfig.publish = [resolveGitHubPublishConfig()];
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
  yield* bundleManagedPaperToolchain(
    stageManagedResourcesDir,
    options.platform,
    options.arch,
    options.verbose,
  );
  yield* bundleManagedScienceRuntime(
    stageManagedResourcesDir,
    options.platform,
    options.arch,
    options.verbose,
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

const bundleManagedPaperToolchain = Effect.fn("bundleManagedPaperToolchain")(function* (
  stageManagedResourcesDir: string,
  platform: typeof BuildPlatform.Type,
  arch: typeof BuildArch.Type,
  verbose: boolean,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const toolchainTargets = resolveManagedPaperToolchainTargets(platform, arch);

  if (toolchainTargets.length === 0) {
    return;
  }

  const toolchainRoot = path.join(stageManagedResourcesDir, MANAGED_PAPER_TOOLCHAIN_RESOURCE_DIR);
  yield* fs.makeDirectory(toolchainRoot, { recursive: true });

  const releaseBaseUrl =
    `https://github.com/tectonic-typesetting/tectonic/releases/download/tectonic%40${MANAGED_PAPER_TOOLCHAIN_TECTONIC_VERSION}`;
  const tempRoot = mkdtempSync(join(tmpdir(), "agentscience-managed-paper-toolchain-"));

  try {
    for (const target of toolchainTargets) {
      const targetTempDir = path.join(tempRoot, target.platformKey);
      const targetToolchainDir = path.join(toolchainRoot, target.platformKey);
      const targetBinDir = path.join(targetToolchainDir, "bin");
      const archivePath = path.join(targetTempDir, target.tectonicArchiveName);
      const extractedBinaryPath = path.join(targetTempDir, "tectonic");
      const packagedBinaryPath = path.join(targetBinDir, "tectonic");

      yield* fs.makeDirectory(targetTempDir, { recursive: true });

      runCheckedCommand({
        command: "curl",
        args: [
          "--fail",
          "--location",
          "--retry",
          "3",
          "--output",
          archivePath,
          `${releaseBaseUrl}/${target.tectonicArchiveName}`,
        ],
        verbose,
      });
      assertSha256(archivePath, target.tectonicSha256);

      yield* fs.remove(targetToolchainDir, { recursive: true, force: true }).pipe(Effect.ignore);
      yield* fs.makeDirectory(targetBinDir, { recursive: true });

      runCheckedCommand({
        command: "tar",
        args: ["-xzf", archivePath, "-C", targetTempDir],
        verbose,
      });

      if (!(yield* fs.exists(extractedBinaryPath))) {
        return yield* new BuildScriptError({
          message: `Missing extracted tectonic binary at ${extractedBinaryPath}.`,
        });
      }

      yield* fs.copyFile(extractedBinaryPath, packagedBinaryPath);
      chmodSync(packagedBinaryPath, 0o755);
      stageManagedPaperToolchainShims(targetBinDir);

      runCheckedCommand({
        command: packagedBinaryPath,
        args: ["--version"],
        verbose,
      });
    }
  } catch (cause) {
    return yield* new BuildScriptError({
      message: "Failed to bundle the managed paper toolchain.",
      cause,
    });
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

const bundleManagedScienceRuntime = Effect.fn("bundleManagedScienceRuntime")(function* (
  stageManagedResourcesDir: string,
  platform: typeof BuildPlatform.Type,
  arch: typeof BuildArch.Type,
  verbose: boolean,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const runtimeTargets = resolveManagedScienceRuntimeTargets(platform, arch);

  if (runtimeTargets.length === 0) {
    return;
  }

  const runtimeRoot = path.join(stageManagedResourcesDir, MANAGED_SCIENCE_RUNTIME_RESOURCE_DIR);
  yield* fs.makeDirectory(runtimeRoot, { recursive: true });

  const pythonChecksumsUrl = `https://github.com/astral-sh/python-build-standalone/releases/download/${MANAGED_SCIENCE_RUNTIME_PYTHON_BUILD_STANDALONE_TAG}/SHA256SUMS`;
  const uvBaseUrl = `https://github.com/astral-sh/uv/releases/download/${MANAGED_SCIENCE_RUNTIME_UV_VERSION}`;
  const tempRoot = mkdtempSync(join(tmpdir(), "agentscience-managed-science-runtime-"));

  try {
    const pythonChecksumsPath = path.join(tempRoot, "python-build-standalone-sha256sums.txt");
    runCheckedCommand({
      command: "curl",
      args: ["--fail", "--location", "--retry", "3", "--output", pythonChecksumsPath, pythonChecksumsUrl],
      verbose,
    });
    const pythonChecksums = readFileSync(pythonChecksumsPath, "utf8");

    for (const target of runtimeTargets) {
      const pythonArchiveName = resolveManagedSciencePythonArchiveName(target);
      const uvArchiveName = resolveManagedScienceUvArchiveName(target);
      const targetTempDir = path.join(tempRoot, target.platformKey);
      const targetRuntimeDir = path.join(runtimeRoot, target.platformKey);
      const pythonArchivePath = path.join(targetTempDir, pythonArchiveName);
      const uvArchivePath = path.join(targetTempDir, uvArchiveName);
      const uvExtractDir = path.join(targetTempDir, "uv-extract");
      const pipCacheDir = path.join(targetTempDir, "pip-cache");

      yield* fs.makeDirectory(targetTempDir, { recursive: true });

      const pythonUrl = `https://github.com/astral-sh/python-build-standalone/releases/download/${MANAGED_SCIENCE_RUNTIME_PYTHON_BUILD_STANDALONE_TAG}/${pythonArchiveName}`;
      runCheckedCommand({
        command: "curl",
        args: ["--fail", "--location", "--retry", "3", "--output", pythonArchivePath, pythonUrl],
        verbose,
      });
      assertSha256(pythonArchivePath, parseChecksumFileEntry(pythonChecksums, pythonArchiveName));

      const uvChecksumPath = path.join(targetTempDir, `${uvArchiveName}.sha256`);
      const uvChecksumUrl = `${uvBaseUrl}/${uvArchiveName}.sha256`;
      runCheckedCommand({
        command: "curl",
        args: ["--fail", "--location", "--retry", "3", "--output", uvChecksumPath, uvChecksumUrl],
        verbose,
      });
      const uvChecksumText = readFileSync(uvChecksumPath, "utf8");

      runCheckedCommand({
        command: "curl",
        args: ["--fail", "--location", "--retry", "3", "--output", uvArchivePath, `${uvBaseUrl}/${uvArchiveName}`],
        verbose,
      });
      assertSha256(uvArchivePath, parseChecksumFileEntry(uvChecksumText, uvArchiveName));

      yield* fs.remove(targetRuntimeDir, { recursive: true, force: true }).pipe(Effect.ignore);
      runCheckedCommand({
        command: "tar",
        args: ["-xzf", pythonArchivePath, "-C", targetTempDir],
        verbose,
      });
      const extractedPythonDir = path.join(targetTempDir, "python");
      const extractedPythonBinary = path.join(extractedPythonDir, "bin", "python3");
      if (!(yield* fs.exists(extractedPythonBinary))) {
        return yield* new BuildScriptError({
          message: `Missing extracted Python runtime at ${extractedPythonBinary}.`,
        });
      }
      yield* fs.rename(extractedPythonDir, targetRuntimeDir);

      yield* fs.makeDirectory(uvExtractDir, { recursive: true });
      runCheckedCommand({
        command: "tar",
        args: ["-xzf", uvArchivePath, "-C", uvExtractDir],
        verbose,
      });
      const extractedUvBinary = path.join(uvExtractDir, `uv-${target.uvTargetTriple}`, "uv");
      if (!(yield* fs.exists(extractedUvBinary))) {
        return yield* new BuildScriptError({
          message: `Missing extracted uv binary at ${extractedUvBinary}.`,
        });
      }
      yield* fs.copyFile(extractedUvBinary, path.join(targetRuntimeDir, "bin", "uv"));

      const pythonEnv = buildManagedScienceRuntimeEnv(targetRuntimeDir, pipCacheDir);
      runCheckedCommand({
        command: path.join(targetRuntimeDir, "bin", "python3"),
        args: [
          "-m",
          "pip",
          "install",
          "--no-cache-dir",
          "--upgrade",
          ...MANAGED_SCIENCE_RUNTIME_PACKAGE_SPECS,
        ],
        env: pythonEnv,
        verbose,
      });
      runCheckedCommand({
        command: path.join(targetRuntimeDir, "bin", "python3"),
        args: [
          "-c",
          "import numpy, pandas, matplotlib, scipy, sklearn, seaborn, statsmodels; print('managed science runtime ready')",
        ],
        env: pythonEnv,
        verbose,
      });
    }
  } catch (cause) {
    return yield* new BuildScriptError({
      message: "Failed to bundle the managed scientific runtime.",
      cause,
    });
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
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
