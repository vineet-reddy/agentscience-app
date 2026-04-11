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
import { GeneralSettingsPanel } from "./SettingsPanels";

function createBaseServerConfig(): ServerConfig {
  return {
    cwd: "/repo/project",
    keybindingsConfigPath: "/repo/project/.agentscience-keybindings.json",
    keybindings: [],
    issues: [],
    providers: [],
    availableEditors: ["cursor"],
    observability: {
      logsDirectoryPath: "/repo/project/.agentscience/logs",
      localTracingEnabled: true,
      otlpTracesUrl: "http://localhost:4318/v1/traces",
      otlpTracesEnabled: true,
      otlpMetricsEnabled: false,
    },
    settings: DEFAULT_SERVER_SETTINGS,
  };
}

describe("GeneralSettingsPanel observability", () => {
  beforeEach(async () => {
    resetServerStateForTests();
    await __resetNativeApiForTests();
    localStorage.clear();
    document.body.innerHTML = "";
  });

  afterEach(async () => {
    resetServerStateForTests();
    await __resetNativeApiForTests();
    document.body.innerHTML = "";
  });

  it("shows diagnostics inside About with a single logs-folder action", async () => {
    setServerConfigSnapshot(createBaseServerConfig());

    await render(
      <AppAtomRegistryProvider>
        <GeneralSettingsPanel />
      </AppAtomRegistryProvider>,
    );

    await expect.element(page.getByText("About")).toBeInTheDocument();
    await expect.element(page.getByText("Diagnostics")).toBeInTheDocument();
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

    await render(
      <AppAtomRegistryProvider>
        <GeneralSettingsPanel />
      </AppAtomRegistryProvider>,
    );

    const openLogsButton = page.getByText("Open logs folder");
    await openLogsButton.click();

    expect(openInEditor).toHaveBeenCalledWith(
      "/repo/project/.agentscience/logs",
      "cursor",
    );
  });

  it("dispatches a workspace root change after the user picks and confirms a folder", async () => {
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

    await render(
      <AppAtomRegistryProvider>
        <GeneralSettingsPanel />
      </AppAtomRegistryProvider>,
    );

    await page.getByRole("button", { name: "Change..." }).click();

    expect(pickFolder).toHaveBeenCalledOnce();
    expect(confirm).toHaveBeenCalledOnce();
    expect(dispatchCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "workspace.rootChange",
        newRoot: "/tmp/NewRoot",
      }),
    );
  });
});
