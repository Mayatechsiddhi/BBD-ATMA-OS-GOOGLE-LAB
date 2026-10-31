import { fixtureClientHeaders } from "./browser-fixture-client";
import assert from "node:assert/strict";
import type { BrowserContext } from "playwright-core";

// Documentation-only IPv6 range; a distinct /64 per synthetic client.
// Better Auth intentionally normalizes IPv6 host addresses to their /64.
export function browserClientIP(run: string, client: number) {
  if (
    !/^[a-f0-9]{4}/i.test(run) ||
    !Number.isInteger(client) ||
    client < 1 ||
    client > 65535
  )
    throw new Error("Invalid synthetic browser client identity");
  return `2001:db8:${run.slice(0, 4).toLowerCase()}:${client.toString(16)}::1`;
}

export async function verifyAuthRateLimits(
  context: BrowserContext,
  base: string,
  run: string,
) {
  // Malformed requests create no users and send no emails. Separate probe /64s
  // cannot consume any account fixture's bucket. Limits are never reset/disabled.
  const shared = browserClientIP(run, 60000);
  const independent = browserClientIP(run, 60001);
  for (const endpoint of ["sign-up/email", "sign-in/email"]) {
    for (let host = 1; host <= 4; host++) {
      const response = await context.request.post(`/api/auth/${endpoint}`, {
        headers: {
          Origin: base,
          ...fixtureClientHeaders(shared.replace(/::1$/, `::${host}`)),
        },
        data: {},
      });
      assert.equal(
        response.status(),
        host === 4 ? 429 : 400,
        `Auth limit must group hosts in one /64 (${endpoint}, attempt ${host})`,
      );
      if (host === 4)
        assert.ok(
          Number(response.headers()["x-retry-after"]) > 0,
          "Throttling must retain retry guidance",
        );
      await response.body();
    }
    const other = await context.request.post(`/api/auth/${endpoint}`, {
      headers: { Origin: base, ...fixtureClientHeaders(independent) },
      data: {},
    });
    assert.equal(
      other.status(),
      400,
      "A different client /64 must have an independent rate bucket",
    );
    await other.body();
  }
  console.log(
    "PASS auth rate-limit regressions: shared /64 blocked on fourth attempt, independent client remains isolated; signup/sign-in limits unchanged",
  );
}
