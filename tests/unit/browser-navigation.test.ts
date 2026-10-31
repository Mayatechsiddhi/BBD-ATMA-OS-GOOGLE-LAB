import { expect, it } from "vitest";
import { assertNavigationStatus } from "../../scripts/browser-navigation";
it("fails at HTTP errors before querying missing forms without including URLs or bodies", () => {
  for (const status of [400, 401, 403, 404, 429, 500, 503])
    expect(() =>
      assertNavigationStatus({ status: () => status }, "members", 123),
    ).toThrow(
      `Browser navigation members failed: HTTP ${status}; elapsed 123ms`,
    );
  expect(() => assertNavigationStatus(null, "display", 15)).toThrow(
    "no-response",
  );
  expect(() =>
    assertNavigationStatus({ status: () => 200 }, "members?token=private", 15),
  ).toThrow("Fixed navigation");
  for (const status of [200, 204])
    expect(() =>
      assertNavigationStatus({ status: () => status }, "members", 15),
    ).not.toThrow();
});

it("checks the real matching document response when goto returns null during a client navigation", async () => {
  const { navigate } = await import("../../scripts/browser-navigation");
  const { vi } = await import("vitest");
  for (const status of [200, 500]) {
    let callback: (r: unknown) => void = () => {};
    const frame = {};
    const url = "https://localhost:3443/members";
    const response = {
      status: () => status,
      url: () => url,
      frame: () => frame,
      request: () => ({ isNavigationRequest: () => true }),
    };
    const page = {
      on: vi.fn((_event, cb) => {
        callback = cb;
      }),
      off: vi.fn(),
      mainFrame: () => frame,
      url: () => url,
      goto: vi.fn(async () => {
        callback(response);
        return null;
      }),
    };
    const result = navigate(
      page as unknown as import("playwright-core").Page,
      "/members",
      "members",
      { timeout: 20000 },
    );
    if (status === 200) expect(await result).toBe(response);
    else await expect(result).rejects.toThrow("HTTP 500");
    expect(page.goto).toHaveBeenCalledExactlyOnceWith("/members", {
      timeout: 20000,
    });
    expect(page.off).toHaveBeenCalledOnce();
  }
});
