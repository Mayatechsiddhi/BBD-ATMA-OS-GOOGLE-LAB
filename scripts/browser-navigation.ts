import assert from "node:assert/strict";
import type { Page, Response } from "playwright-core";
/** Fixed labels only: URLs, response bodies and headers can contain credentials. */
export function assertNavigationStatus(
  response: Pick<Response, "status"> | null,
  label: string,
  elapsedMs: number,
) {
  assert.ok(
    /^[a-z][a-z0-9-]{0,63}$/.test(label),
    "Fixed navigation diagnostic label required",
  );
  const status = response?.status();
  assert.ok(
    status !== undefined && status >= 200 && status < 300,
    `Browser navigation ${label} failed: HTTP ${status ?? "no-response"}; elapsed ${Math.round(elapsedMs)}ms; inspect private browser/server traces`,
  );
}
export async function navigate(
  page: Page,
  url: string,
  label: string,
  options?: Parameters<Page["goto"]>[1],
) {
  const start = Date.now();
  const observed: Response[] = [];
  const capture = (response: Response) => {
    if (
      !response.request().isNavigationRequest() ||
      response.frame() !== page.mainFrame()
    )
      return;
    const expected = new URL(url, response.url());
    expected.hash = "";
    if (response.url() === expected.href) observed.push(response);
  };
  page.on("response", capture);
  try {
    const response = await page.goto(url, options);
    // A client same-document navigation may race commit and make goto return null.
    // Still require the actual matching main-frame document response, not a retry
    // or a cached status from a prior navigation. Evidence: retained CRM trace.
    let fallback: Response | null = observed.at(-1) ?? null;
    if (!response && fallback) {
      const final = new URL(page.url());
      final.hash = "";
      if (final.href !== fallback.url()) fallback = null;
    }
    assertNavigationStatus(response ?? fallback, label, Date.now() - start);
    return response ?? fallback;
  } finally {
    page.off("response", capture);
  }
}
