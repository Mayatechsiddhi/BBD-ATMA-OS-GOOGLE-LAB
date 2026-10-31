import { timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";
import type { IncomingHttpHeaders } from "node:http";
/** Fixture-only attestation: neither forwarded IPs nor the gateway key are client authority. */
export function gatewayHeaders(
  input: IncomingHttpHeaders,
  clients: Readonly<Record<string, string>>,
  key: string,
  host: string,
): Record<string, string> | null {
  if (input.host !== host || typeof input["x-bbd-fixture-client"] !== "string")
    return null;
  const supplied = input["x-bbd-fixture-client"];
  if (!/^[a-f0-9]{64}$/.test(supplied)) return null;
  const client = Object.entries(clients).find(
    ([ip, token]) =>
      isIP(ip) &&
      /^[a-f0-9]{64}$/.test(token) &&
      token.length === supplied.length &&
      timingSafeEqual(Buffer.from(token), Buffer.from(supplied)),
  );
  if (!client) return null;
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(input)) {
    if (
      /^(host|connection|forwarded|x-forwarded-.*|x-real-ip|cf-connecting-ip|x-bbd-.*)$/i.test(
        name,
      )
    )
      continue;
    if (typeof value === "string") headers[name] = value;
  }
  return {
    ...headers,
    host,
    "x-forwarded-host": host,
    "x-forwarded-proto": "https",
    "x-bbd-client-ip": client[0],
    "x-bbd-auth-proxy-key": key,
  };
}

/** Refuse pg query-string overrides before opening any fixture connection. */
export function localFixtureDatabases(
  ownerValue: string | undefined,
  runtimeValue: string | undefined,
) {
  if (!ownerValue || !runtimeValue)
    throw Error("Dedicated local test database URLs required");
  const owner = new URL(ownerValue),
    runtime = new URL(runtimeValue);
  for (const url of [owner, runtime]) {
    if (
      !["postgres:", "postgresql:"].includes(url.protocol) ||
      !["localhost", "127.0.0.1"].includes(url.hostname) ||
      !/^\/[a-zA-Z0-9_]+_test$/.test(url.pathname) ||
      url.hash ||
      [...url.searchParams].some(
        ([name, value]) => name !== "schema" || value !== "public",
      )
    )
      throw Error(
        "Dedicated local test database without connection overrides required",
      );
  }
  if (
    owner.hostname !== runtime.hostname ||
    (owner.port || "5432") !== (runtime.port || "5432") ||
    owner.pathname !== runtime.pathname ||
    !owner.username ||
    !runtime.username ||
    owner.username === runtime.username
  )
    throw Error(
      "Separate owner/runtime roles for the same local test database required",
    );
  return { owner, runtime };
}
