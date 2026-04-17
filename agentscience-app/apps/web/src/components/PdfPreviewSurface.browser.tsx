import { render } from "vitest-browser-react";
import { afterEach, expect, it, vi } from "vitest";

import PdfPreviewSurface from "./PdfPreviewSurface";

afterEach(() => {
  vi.unstubAllGlobals();
});

it("renders the preview shell without violating hook order", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      () =>
        new Promise<Response>(() => {
          // Keep the request pending so the component stays in its initial loading state.
        }),
    ),
  );

  const screen = await render(<PdfPreviewSurface title="Test paper" url="/api/paper-review/test/files/paper.pdf" />);

  await expect.element(screen.getByText("Loading paper preview...")).toBeVisible();
  await expect.element(screen.getByLabelText("Test paper preview")).toBeVisible();
});
