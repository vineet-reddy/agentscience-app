import "../../index.css";

import {
  DEFAULT_SERVER_SETTINGS,
  type NativeApi,
  type ServerConfig,
} from "@agentscience/contracts";
import { page } from "vitest/browser";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import { __resetNativeApiForTests } from "../../nativeApi";
import { AppAtomRegistryProvider } from "../../rpc/atomRegistry";
import {
  resetServerStateForTests,
  setServerConfigSnapshot,
} from "../../rpc/serverState";

const FIXTURE_RUNTIME_PERSONALITY = {
  version: "1.0.2",
  contentHash: "4161bece40c054b067d73da067a2eb1f7ed42648e9e4d019096bd8ae749911a3",
} as const;
const FIXTURE_AGENTSCIENCE_RUNTIME = {
  state: "checking" as const,
  checkedAt: "2026-04-15T08:00:00.000Z",
  ok: false,
  updateAvailable: false,
  refreshRecommended: false,
  nextSteps: [],
};

function createBaseServerConfig(): ServerConfig {
  return {
    cwd: "/repo/project",
    providers: [],
    availableEditors: ["cursor"],
    observability: {
      logsDirectoryPath: "/repo/project/.agentscience/logs",
      localTracingEnabled: true,
      otlpTracesUrl: "http://localhost:4318/v1/traces",
      otlpTracesEnabled: true,
      otlpMetricsEnabled: false,
    },
    runtime: {
      personality: FIXTURE_RUNTIME_PERSONALITY,
      agentScience: FIXTURE_AGENTSCIENCE_RUNTIME,
    },
    settings: DEFAULT_SERVER_SETTINGS,
  };
}

function createCodexProvider(overrides?: Partial<ServerConfig["providers"][number]>) {
  return {
    provider: "codex" as const,
    enabled: true,
    installed: true,
    version: "0.120.0",
    status: "error" as const,
    auth: {
      status: "unauthenticated" as const,
    },
    checkedAt: "2026-04-14T12:00:00.000Z",
    message: "Codex is not connected yet. Sign in with ChatGPT or add an API key in AgentScience.",
    models: [],
    ...overrides,
  };
}

async function renderGeneralSettingsPanel() {
  const { GeneralSettingsPanel } = await import("./SettingsPanels");
  return render(
    <AppAtomRegistryProvider>
      <GeneralSettingsPanel />
    </AppAtomRegistryProvider>,
  );
}

describe("GeneralSettingsPanel observability", () => {
  beforeEach(async () => {
    vi.resetModules();
    resetServerStateForTests();
    await __resetNativeApiForTests();
    Reflect.deleteProperty(window, "nativeApi");
    Reflect.deleteProperty(window, "desktopBridge");
    localStorage.clear();
    document.body.innerHTML = "";
  });

  afterEach(async () => {
    resetServerStateForTests();
    await __resetNativeApiForTests();
    Reflect.deleteProperty(window, "nativeApi");
    Reflect.deleteProperty(window, "desktopBridge");
    document.body.innerHTML = "";
  });

  it("shows diagnostics inside About with a single logs-folder action", async () => {
    setServerConfigSnapshot(createBaseServerConfig());

    await renderGeneralSettingsPanel();

    await expect.element(page.getByText("About")).toBeInTheDocument();
    await expect.element(page.getByText("Diagnostics")).toBeInTheDocument();
    await expect
      .element(page.getByText("Shared personality"))
      .toBeInTheDocument();
    await expect
      .element(page.getByText("Open logs folder"))
      .toBeInTheDocument();
    await expect
      .element(
        page.getByText("/repo/project/.agentscience/logs", { exact: true }),
      )
      .toBeInTheDocument();
    await expect
      .element(
        page.getByText(
          "Local trace file. OTLP exporting traces to http://localhost:4318/v1/traces.",
        ),
      )
      .toBeInTheDocument();
    await expect
      .element(
        page.getByText(
          FIXTURE_RUNTIME_PERSONALITY.contentHash,
          { exact: true },
        ),
      )
      .toBeInTheDocument();
  });

  it("opens the logs folder in the preferred editor", async () => {
    const openInEditor = vi
      .fn<NativeApi["shell"]["openInEditor"]>()
      .mockResolvedValue(undefined);
    window.nativeApi = {
      shell: {
        openInEditor,
      },
    } as unknown as NativeApi;

    setServerConfigSnapshot(createBaseServerConfig());

    await renderGeneralSettingsPanel();

    const openLogsButton = page.getByText("Open logs folder");
    await openLogsButton.click();

    expect(openInEditor).toHaveBeenCalledWith(
      "/repo/project/.agentscience/logs",
      "cursor",
    );
  });

  it("keeps workspace root changes disabled in the browser harness", async () => {
    const dispatchCommand = vi
      .fn<NativeApi["orchestration"]["dispatchCommand"]>()
      .mockResolvedValue({ sequence: 12 });
    const pickFolder = vi
      .fn<NativeApi["dialogs"]["pickFolder"]>()
      .mockResolvedValue("/tmp/NewRoot");
    const confirm = vi
      .fn<NativeApi["dialogs"]["confirm"]>()
      .mockResolvedValue(true);

    window.nativeApi = {
      dialogs: {
        pickFolder,
        confirm,
      },
      orchestration: {
        dispatchCommand,
      },
    } as unknown as NativeApi;

    setServerConfigSnapshot(createBaseServerConfig());

    await renderGeneralSettingsPanel();

    await expect
      .element(page.getByRole("button", { name: "Change..." }))
      .toBeDisabled();
    expect(pickFolder).not.toHaveBeenCalled();
    expect(confirm).not.toHaveBeenCalled();
    expect(dispatchCommand).not.toHaveBeenCalled();
  });

  it("starts the ChatGPT browser login from Codex settings", async () => {
    const getCodexAuthState = vi.fn<NativeApi["server"]["getCodexAuthState"]>().mockResolvedValue({
      status: "idle",
      updatedAt: "2026-04-14T12:00:00.000Z",
      defaultHomePath: "/repo/project/.agentscience/codex",
    });
    const startCodexChatgptLogin = vi
      .fn<NativeApi["server"]["startCodexChatgptLogin"]>()
      .mockResolvedValue({
        status: "pending",
        updatedAt: "2026-04-14T12:01:00.000Z",
        defaultHomePath: "/repo/project/.agentscience/codex",
        loginType: "chatgpt",
        loginId: "login-1",
        authUrl: "https://chatgpt.com/codex-login",
      });
    const openExternal = vi.fn<NativeApi["shell"]["openExternal"]>().mockResolvedValue(undefined);

    window.nativeApi = {
      server: {
        getCodexAuthState,
        startCodexChatgptLogin,
        refreshProviders: vi.fn().mockResolvedValue({ providers: [] }),
      },
      shell: {
        openExternal,
      },
    } as unknown as NativeApi;

    setServerConfigSnapshot({
      ...createBaseServerConfig(),
      providers: [createCodexProvider()],
    });

    await renderGeneralSettingsPanel();

    await expect.element(page.getByText("Connection")).toBeInTheDocument();
    await page.getByRole("button", { name: "Continue with ChatGPT" }).click();

    expect(startCodexChatgptLogin).toHaveBeenCalledOnce();
    expect(openExternal).toHaveBeenCalledWith("https://chatgpt.com/codex-login");
  });

  it("submits an API key from Codex settings", async () => {
    const getCodexAuthState = vi.fn<NativeApi["server"]["getCodexAuthState"]>().mockResolvedValue({
      status: "idle",
      updatedAt: "2026-04-14T12:00:00.000Z",
      defaultHomePath: "/repo/project/.agentscience/codex",
    });
    const loginCodexWithApiKey = vi
      .fn<NativeApi["server"]["loginCodexWithApiKey"]>()
      .mockResolvedValue({
        status: "idle",
        updatedAt: "2026-04-14T12:02:00.000Z",
        defaultHomePath: "/repo/project/.agentscience/codex",
      });

    window.nativeApi = {
      server: {
        getCodexAuthState,
        loginCodexWithApiKey,
        refreshProviders: vi.fn().mockResolvedValue({ providers: [] }),
      },
    } as unknown as NativeApi;

    setServerConfigSnapshot({
      ...createBaseServerConfig(),
      providers: [createCodexProvider()],
    });

    await renderGeneralSettingsPanel();

    await page.getByRole("button", { name: "Use API key" }).click();
    await page.getByPlaceholder("sk-...").fill("sk-test-key");
    await page.getByRole("button", { name: "Save API key" }).click();

    expect(loginCodexWithApiKey).toHaveBeenCalledWith({ apiKey: "sk-test-key" });
  });

  it("keeps internal Codex profile jargon out of the default settings surface", async () => {
    window.nativeApi = {
      server: {
        getCodexAuthState: vi.fn().mockResolvedValue({
          status: "idle",
          updatedAt: "2026-04-14T12:00:00.000Z",
          defaultHomePath: "/repo/project/.agentscience/codex",
        }),
      },
    } as unknown as NativeApi;

    setServerConfigSnapshot({
      ...createBaseServerConfig(),
      providers: [createCodexProvider()],
    });

    await renderGeneralSettingsPanel();

    await expect
      .element(page.getByRole("button", { name: "Continue with ChatGPT" }))
      .toBeInTheDocument();
    await expect
      .element(page.getByRole("button", { name: "Use API key" }))
      .toBeInTheDocument();
    await expect
      .element(page.getByText("Standalone AgentScience profile"))
      .not.toBeInTheDocument();
    await expect
      .element(page.getByText("Use desktop profile"))
      .not.toBeInTheDocument();
  });

  it("shows one clear Codex connection state when already signed in", async () => {
    window.nativeApi = {
      server: {
        getCodexAuthState: vi.fn().mockResolvedValue({
          status: "idle",
          updatedAt: "2026-04-14T12:00:00.000Z",
          defaultHomePath: "/repo/project/.agentscience/codex",
        }),
      },
    } as unknown as NativeApi;

    setServerConfigSnapshot({
      ...createBaseServerConfig(),
      providers: [
        createCodexProvider({
          status: "ready",
          auth: {
            status: "authenticated",
            type: "chatgpt",
            label: "ChatGPT Pro Subscription",
          },
          message: "AgentScience is ready to use.",
        }),
      ],
    });

    await renderGeneralSettingsPanel();

    await expect
      .element(page.getByText("Using ChatGPT Pro Subscription"))
      .toBeInTheDocument();
    await expect
      .element(page.getByText("Connected with ChatGPT Pro Subscription."))
      .not.toBeInTheDocument();
  });

  it("applies AgentScience updates from Settings without exposing shell commands", async () => {
    const applyAgentScienceRuntimeUpdates = vi
      .fn<NativeApi["server"]["applyAgentScienceRuntimeUpdates"]>()
      .mockResolvedValue({
        state: "ready",
        checkedAt: "2026-04-15T12:02:00.000Z",
        ok: true,
        updateAvailable: false,
        refreshRecommended: false,
        nextSteps: [],
        cli: {
          version: "0.5.2",
          latestVersion: "0.5.2",
        },
      });

    window.nativeApi = {
      server: {
        applyAgentScienceRuntimeUpdates,
      },
    } as unknown as NativeApi;

    setServerConfigSnapshot({
      ...createBaseServerConfig(),
      runtime: {
        personality: FIXTURE_RUNTIME_PERSONALITY,
        agentScience: {
          state: "ready",
          checkedAt: "2026-04-15T12:00:00.000Z",
          ok: true,
          updateAvailable: true,
          refreshRecommended: false,
          nextSteps: ["npm install -g agentscience@latest"],
          cli: {
            version: "0.5.1",
            latestVersion: "0.5.2",
          },
        },
      },
    });

    await renderGeneralSettingsPanel();

    await expect
      .element(page.getByRole("button", { name: "Update tools" }))
      .toBeInTheDocument();
    await expect
      .element(page.getByText("npm install -g agentscience@latest"))
      .not.toBeInTheDocument();

    await page.getByRole("button", { name: "Update tools" }).click();

    expect(applyAgentScienceRuntimeUpdates).toHaveBeenCalledOnce();
  });
});
