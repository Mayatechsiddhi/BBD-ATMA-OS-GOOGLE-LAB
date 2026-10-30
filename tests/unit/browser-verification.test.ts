import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { APIRequestContext } from "playwright-core";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("../../scripts/local-admin-db", () => ({
  adminDb: { user: { findUnique: vi.fn(), findUniqueOrThrow: vi.fn() } },
}));
import { adminDb } from "../../scripts/local-admin-db";
import { verifyFixtureEmail } from "../../scripts/browser-verification";
let directory: string;
const prior = process.env.BROWSER_ARTIFACT_DIR;
const url =
  "http://localhost:3000/api/auth/verify-email?token=PRIVATE_SYNTHETIC_TOKEN&callbackURL=%2Forganizations";
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "bbd-browser-verification-unit-"));
  process.env.BROWSER_ARTIFACT_DIR = directory;
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  if (prior === undefined) delete process.env.BROWSER_ARTIFACT_DIR;
  else process.env.BROWSER_ARTIFACT_DIR = prior;
  rmSync(directory, { recursive: true, force: true });
  vi.restoreAllMocks();
  vi.clearAllMocks();
});
it("retains the original timeout and records no token, URL query or fixture identity", async () => {
  const failure = Object.assign(new Error(url), { name: "TimeoutError" });
  const get = vi.fn().mockRejectedValue(failure);
  vi.mocked(adminDb.user.findUnique).mockResolvedValue({
    emailVerified: false,
  } as never);
  await expect(
    verifyFixtureEmail(
      { get } as unknown as APIRequestContext,
      url,
      "PRIVATE_USER_ID",
      "owner",
    ),
  ).rejects.toBe(failure);
  expect(get).toHaveBeenCalledWith(url, { maxRedirects: 0, timeout: 15000 });
  const record = readFileSync(
    join(directory, "verification-api.jsonl"),
    "utf8",
  );
  expect(record).not.toMatch(/PRIVATE_|callbackURL|token=/);
  expect(JSON.parse(record)).toMatchObject({
    endpoint: "/api/auth/verify-email",
    verified: false,
    errorType: "TimeoutError",
  });
});
it("rejects a successful HTTP status without persisted verification", async () => {
  vi.mocked(adminDb.user.findUniqueOrThrow).mockResolvedValue({
    emailVerified: false,
  } as never);
  vi.mocked(adminDb.user.findUnique).mockResolvedValue({
    emailVerified: false,
  } as never);
  await expect(
    verifyFixtureEmail(
      {
        get: vi.fn().mockResolvedValue({ status: () => 200 }),
      } as unknown as APIRequestContext,
      url,
      "synthetic",
      "owner",
    ),
  ).rejects.toThrow("Verification must persist");
});
it("accepts the existing redirect only after the real persisted flag is true", async () => {
  vi.mocked(adminDb.user.findUniqueOrThrow).mockResolvedValue({
    emailVerified: true,
  } as never);
  await verifyFixtureEmail(
    {
      get: vi.fn().mockResolvedValue({ status: () => 302 }),
    } as unknown as APIRequestContext,
    url,
    "synthetic",
    "owner",
  );
  expect(
    JSON.parse(readFileSync(join(directory, "verification-api.jsonl"), "utf8")),
  ).toMatchObject({ status: 302, verified: true });
});
