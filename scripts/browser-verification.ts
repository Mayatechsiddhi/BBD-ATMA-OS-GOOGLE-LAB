import assert from "node:assert/strict";
import { appendFileSync, mkdirSync } from "node:fs";
import type { APIRequestContext } from "playwright-core";
import { adminDb } from "./local-admin-db";

/** APIRequestContext traffic before the first Page is absent from page traces.
 * Record only fixed endpoint/status/timing and this fixture's verified boolean.
 */
export async function verifyFixtureEmail(
  client: APIRequestContext,
  url: string,
  userId: string,
  label: string,
) {
  const parsed = new URL(url);
  assert.ok(["localhost", "127.0.0.1"].includes(parsed.hostname));
  assert.equal(parsed.pathname, "/api/auth/verify-email");
  const started = Date.now();
  let status: number | undefined,
    verified: boolean | undefined,
    errorType: string | undefined,
    elapsedMs: number | undefined;
  try {
    const response = await client.get(url, { maxRedirects: 0, timeout: 15000 });
    elapsedMs = Date.now() - started;
    status = response.status();
    assert.ok(
      [200, 302].includes(status),
      "Real fixture email verification must succeed",
    );
    verified = (
      await adminDb.user.findUniqueOrThrow({
        where: { id: userId },
        select: { emailVerified: true },
      })
    ).emailVerified;
    assert.equal(verified, true, "Verification must persist before UI sign-in");
  } catch (error) {
    elapsedMs ??= Date.now() - started;
    errorType = error instanceof Error ? error.name : "unknown";
    try {
      verified = (
        await adminDb.user.findUnique({
          where: { id: userId },
          select: { emailVerified: true },
        })
      )?.emailVerified;
    } catch {
      /* Preserve the original transport/assertion failure. */
    }
    throw error;
  } finally {
    const record = {
      label,
      endpoint: "/api/auth/verify-email",
      method: "GET",
      elapsedMs,
      status,
      verified,
      errorType,
    };
    try {
      const directory = process.env.BROWSER_ARTIFACT_DIR;
      if (directory) {
        assert.ok(directory.startsWith("/tmp/bbd-browser-"));
        mkdirSync(directory, { recursive: true, mode: 0o700 });
        appendFileSync(
          `${directory}/verification-api.jsonl`,
          JSON.stringify(record) + "\n",
          { mode: 0o600 },
        );
      }
      console.log("CHECK verification fixture " + JSON.stringify(record));
    } catch {
      console.error(
        "Verification diagnostic could not be saved; details suppressed.",
      );
      if (!errorType) throw new Error("Verification diagnostic capture failed");
    }
  }
}
