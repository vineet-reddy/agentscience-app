import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, watch, writeFileSync } from "node:fs";
import { join } from "node:path";

import { desktopDir, resolveElectronPath } from "./electron-launcher.mjs";
import { waitForResources } from "./wait-for-resources.mjs";

const port = Number(process.env.ELECTRON_RENDERER_PORT ?? 5733);
const devServerUrl = `http://localhost:${port}`;
const requiredFiles = [
  "dist-electron/main.js",
  "dist-electron/preload.js",
  "../server/dist/bin.mjs",
];
const watchedDirectories = [
  { directory: "dist-electron", files: new Set(["main.js", "preload.js"]) },
  { directory: "../server/dist", files: new Set(["bin.mjs"]) },
];
const runtimeDir = join(desktopDir, ".electron-runtime");
const serverDir = join(desktopDir, "../server");
const launcherLockPath = join(runtimeDir, "dev-electron.lock.json");
const forcedShutdownTimeoutMs = 1_500;
const restartDebounceMs = 120;
const childTreeGracePeriodMs = 1_200;

const childEnv = { ...process.env };
delete childEnv.ELECTRON_RUN_AS_NODE;

let shuttingDown = false;
let restartTimer = null;
let currentApp = null;
let serverBundleWatcher = null;
let restartQueue = Promise.resolve();
const expectedExits = new WeakSet();
const watchers = [];

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function readLauncherLockPid() {
  try {
    const raw = JSON.parse(readFileSync(launcherLockPath, "utf8"));
    return typeof raw?.pid === "number" ? raw.pid : null;
  } catch {
    return null;
  }
}

function tryAcquireLauncherLock() {
  mkdirSync(runtimeDir, { recursive: true });

  try {
    writeFileSync(launcherLockPath, `${JSON.stringify({ pid: process.pid })}\n`, {
      flag: "wx",
    });
    return true;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "EEXIST") {
      return false;
    }
    throw error;
  }
}

function isProcessAlive(pid) {
  if (typeof pid !== "number" || pid <= 0) {
    return false;
  }

  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function readProcessCommand(pid) {
  if (process.platform === "win32") {
    return null;
  }

  const result = spawnSync("ps", ["-p", String(pid), "-o", "command="], {
    encoding: "utf8",
  });
  if (result.status !== 0) {
    return null;
  }

  return result.stdout.trim();
}

function isDevElectronLauncher(pid) {
  const command = readProcessCommand(pid);
  return typeof command === "string" && command.includes("dev-electron.mjs");
}

async function ensureExclusiveLauncher() {
  if (tryAcquireLauncherLock()) {
    return;
  }

  const existingPid = readLauncherLockPid();
  if (
    typeof existingPid === "number" &&
    existingPid !== process.pid &&
    isProcessAlive(existingPid) &&
    isDevElectronLauncher(existingPid)
  ) {
    try {
      process.kill(existingPid, "SIGTERM");
    } catch {}

    await sleep(childTreeGracePeriodMs);

    if (isProcessAlive(existingPid) && isDevElectronLauncher(existingPid)) {
      try {
        process.kill(existingPid, "SIGKILL");
      } catch {}
    }
  }

  rmSync(launcherLockPath, { force: true });

  if (!tryAcquireLauncherLock()) {
    process.exit(0);
  }
}

function releaseLauncherLock() {
  if (readLauncherLockPid() === process.pid) {
    rmSync(launcherLockPath, { force: true });
  }
}

function killChildTreeByPid(pid, signal) {
  if (process.platform === "win32" || typeof pid !== "number") {
    return;
  }

  spawnSync("pkill", [`-${signal}`, "-P", String(pid)], { stdio: "ignore" });
}

function cleanupStaleDevApps() {
  if (process.platform === "win32") {
    return;
  }

  spawnSync("pkill", ["-f", "--", `--agentscience-dev-root=${desktopDir}`], { stdio: "ignore" });
}

function runInitialServerBundleBuild() {
  const result = spawnSync("bun", ["tsdown"], {
    cwd: serverDir,
    env: childEnv,
    stdio: "inherit",
    shell: process.platform === "win32",
  });

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function startServerBundleWatcher() {
  if (serverBundleWatcher !== null) {
    return;
  }

  const watcher = spawn("bun", ["tsdown", "--watch"], {
    cwd: serverDir,
    env: childEnv,
    stdio: "inherit",
    shell: process.platform === "win32",
  });

  serverBundleWatcher = watcher;

  watcher.once("error", (error) => {
    if (serverBundleWatcher === watcher) {
      serverBundleWatcher = null;
    }
    console.error("[dev-electron] Server bundle watcher failed:", error);
    if (!shuttingDown) {
      void shutdown(1);
    }
  });

  watcher.once("exit", (code, signal) => {
    if (serverBundleWatcher === watcher) {
      serverBundleWatcher = null;
    }

    if (!shuttingDown && (signal !== null || code !== 0)) {
      console.error(
        `[dev-electron] Server bundle watcher exited unexpectedly (${signal ?? code}).`,
      );
      void shutdown(code ?? 1);
    }
  });
}

function startApp() {
  if (shuttingDown || currentApp !== null) {
    return;
  }

  const app = spawn(
    resolveElectronPath(),
    [`--agentscience-dev-root=${desktopDir}`, "dist-electron/main.js"],
    {
      cwd: desktopDir,
      env: {
        ...childEnv,
        VITE_DEV_SERVER_URL: devServerUrl,
      },
      stdio: "inherit",
    },
  );

  currentApp = app;

  app.once("error", () => {
    if (currentApp === app) {
      currentApp = null;
    }

    if (!shuttingDown) {
      scheduleRestart();
    }
  });

  app.once("exit", (code, signal) => {
    if (currentApp === app) {
      currentApp = null;
    }

    const exitedAbnormally = signal !== null || code !== 0;
    if (!shuttingDown && !expectedExits.has(app) && exitedAbnormally) {
      scheduleRestart();
    }
  });
}

async function stopApp() {
  const app = currentApp;
  if (!app) {
    return;
  }

  currentApp = null;
  expectedExits.add(app);

  await new Promise((resolve) => {
    let settled = false;

    const finish = () => {
      if (settled) {
        return;
      }

      settled = true;
      resolve();
    };

    app.once("exit", finish);
    app.kill("SIGTERM");
    killChildTreeByPid(app.pid, "TERM");

    setTimeout(() => {
      if (settled) {
        return;
      }

      app.kill("SIGKILL");
      killChildTreeByPid(app.pid, "KILL");
      finish();
    }, forcedShutdownTimeoutMs).unref();
  });
}

async function stopServerBundleWatcher() {
  const watcher = serverBundleWatcher;
  if (!watcher) {
    return;
  }

  serverBundleWatcher = null;

  await new Promise((resolve) => {
    let settled = false;

    const finish = () => {
      if (settled) {
        return;
      }

      settled = true;
      resolve();
    };

    watcher.once("exit", finish);
    watcher.kill("SIGTERM");
    killChildTreeByPid(watcher.pid, "TERM");

    setTimeout(() => {
      if (settled) {
        return;
      }

      watcher.kill("SIGKILL");
      killChildTreeByPid(watcher.pid, "KILL");
      finish();
    }, forcedShutdownTimeoutMs).unref();
  });
}

function scheduleRestart() {
  if (shuttingDown) {
    return;
  }

  if (restartTimer) {
    clearTimeout(restartTimer);
  }

  restartTimer = setTimeout(() => {
    restartTimer = null;
    restartQueue = restartQueue
      .catch(() => undefined)
      .then(async () => {
        await stopApp();
        if (!shuttingDown) {
          startApp();
        }
      });
  }, restartDebounceMs);
}

function startWatchers() {
  for (const { directory, files } of watchedDirectories) {
    const watcher = watch(
      join(desktopDir, directory),
      { persistent: true },
      (_eventType, filename) => {
        if (typeof filename !== "string" || !files.has(filename)) {
          return;
        }

        scheduleRestart();
      },
    );

    watchers.push(watcher);
  }
}

function killChildTree(signal) {
  if (process.platform === "win32") {
    return;
  }

  // Kill direct children as a final fallback in case normal shutdown leaves stragglers.
  spawnSync("pkill", [`-${signal}`, "-P", String(process.pid)], { stdio: "ignore" });
}

async function shutdown(exitCode) {
  if (shuttingDown) return;
  shuttingDown = true;

  if (restartTimer) {
    clearTimeout(restartTimer);
    restartTimer = null;
  }

  for (const watcher of watchers) {
    watcher.close();
  }

  await stopServerBundleWatcher();
  await stopApp();
  killChildTree("TERM");
  await sleep(childTreeGracePeriodMs);
  killChildTree("KILL");
  releaseLauncherLock();

  process.exit(exitCode);
}

await ensureExclusiveLauncher();
process.once("exit", releaseLauncherLock);

runInitialServerBundleBuild();
startServerBundleWatcher();
await waitForResources({
  baseDir: desktopDir,
  files: requiredFiles,
  tcpPort: port,
});
startWatchers();
cleanupStaleDevApps();
startApp();

process.once("SIGINT", () => {
  void shutdown(130);
});
process.once("SIGTERM", () => {
  void shutdown(143);
});
process.once("SIGHUP", () => {
  void shutdown(129);
});
