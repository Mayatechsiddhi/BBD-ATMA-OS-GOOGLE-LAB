import { expect, it } from "vitest";
import {
  gatewayHeaders,
  localFixtureDatabases,
} from "../../scripts/browser-fixture-gateway";
it("requires an attested fixture credential and overwrites all caller ingress identities", () => {
  const ip = "2001:db8:abcd:1::1",
    token = "a".repeat(64),
    key = "server-only";
  expect(
    gatewayHeaders(
      { host: "localhost:3443", "x-forwarded-for": ip },
      { [ip]: token },
      key,
      "localhost:3443",
    ),
  ).toBeNull();
  expect(
    gatewayHeaders(
      { host: "evil", "x-bbd-fixture-client": token },
      { [ip]: token },
      key,
      "localhost:3443",
    ),
  ).toBeNull();
  expect(
    gatewayHeaders(
      { host: "localhost:3443", "x-bbd-fixture-client": "é".repeat(64) },
      { [ip]: token },
      key,
      "localhost:3443",
    ),
  ).toBeNull();
  const h = gatewayHeaders(
    {
      host: "localhost:3443",
      "x-bbd-fixture-client": token,
      "x-forwarded-for": "evil",
      "x-bbd-client-ip": "evil",
      "x-bbd-auth-proxy-key": "evil",
      cookie: "signed-session",
      origin: "https://localhost:3443",
    },
    { [ip]: token },
    key,
    "localhost:3443",
  )!;
  expect(h["x-bbd-client-ip"]).toBe(ip);
  expect(h["x-bbd-auth-proxy-key"]).toBe(key);
  expect(h["x-forwarded-for"]).toBeUndefined();
  expect(h["x-bbd-fixture-client"]).toBeUndefined();
  expect(h.cookie).toBe("signed-session");
  expect(h.origin).toBe("https://localhost:3443");
});

it("rejects effective pg host/database overrides and mismatched fixture destinations before connecting", () => {
  const owner = "postgresql://owner:synthetic@localhost/bbd_test?schema=public";
  const runtime =
    "postgresql://runtime:synthetic@localhost/bbd_test?schema=public";
  expect(localFixtureDatabases(owner, runtime).runtime.pathname).toBe(
    "/bbd_test",
  );
  for (const value of [
    runtime + "&host=203.0.113.1",
    runtime + "&port=9999",
    runtime + "&dbname=production",
    runtime.replace("bbd_test", "bbd"),
    runtime.replace("localhost", "remote.example"),
    runtime.replace("localhost", "127.0.0.1:9999"),
    runtime.replace("runtime:", "owner:"),
    runtime.replace("schema=public", "schema=private"),
  ])
    expect(() => localFixtureDatabases(owner, value)).toThrow();
});
