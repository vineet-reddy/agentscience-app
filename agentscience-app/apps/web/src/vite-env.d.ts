/// <reference types="vite/client" />

import type { NativeApi, DesktopBridge } from "@agentscience/contracts";
import type { DetailedHTMLProps, HTMLAttributes } from "react";

interface ImportMetaEnv {
  readonly APP_VERSION: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare global {
  namespace JSX {
    interface IntrinsicElements {
      webview: DetailedHTMLProps<
        HTMLAttributes<HTMLElement> & {
          src?: string;
          partition?: string;
          allowpopups?: boolean | string;
        },
        HTMLElement
      >;
    }
  }

  interface Window {
    nativeApi?: NativeApi;
    desktopBridge?: DesktopBridge;
  }
}
