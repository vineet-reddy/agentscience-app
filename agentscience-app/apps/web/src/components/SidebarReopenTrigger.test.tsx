import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { SidebarReopenTrigger } from "./SidebarReopenTrigger";
import { SidebarProvider } from "./ui/sidebar";

describe("SidebarReopenTrigger", () => {
  it("renders when the sidebar is collapsed", () => {
    const html = renderToStaticMarkup(
      <SidebarProvider defaultOpen={false}>
        <SidebarReopenTrigger />
      </SidebarProvider>,
    );

    expect(html).toContain('aria-label="Expand sidebar"');
  });

  it("stays hidden when the sidebar is open", () => {
    const html = renderToStaticMarkup(
      <SidebarProvider defaultOpen>
        <SidebarReopenTrigger />
      </SidebarProvider>,
    );

    expect(html).not.toContain('aria-label="Expand sidebar"');
  });
});
