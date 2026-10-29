/** Real production-mode HTTP regression on loopback and a dedicated test DB.
 * Simulates a gateway; does not claim real ingress/TLS or production-browser coverage.
 */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createServer } from "node:net";
import pg from "pg";
if (fs.existsSync(".env")) process.loadEnvFile(".env");
let server,
  metadata,
  connected = false;
let prefix;
try {
  const owner = new URL(process.env.TEST_DATABASE_URL);
  const runtime = new URL(process.env.TEST_RUNTIME_DATABASE_URL);
  for (const url of [owner, runtime])
    assert.ok(
      ["localhost", "127.0.0.1"].includes(url.hostname) &&
        url.pathname.endsWith("_test"),
      "Dedicated local test database required",
    );
  assert.equal(owner.hostname, runtime.hostname);
  assert.equal(owner.port, runtime.port);
  assert.equal(owner.pathname, runtime.pathname);
  const available = createServer();
  await new Promise((resolve, reject) => {
    available.once("error", reject);
    available.listen(3100, "127.0.0.1", resolve);
  });
  await new Promise((resolve) => available.close(resolve));
  const key = randomBytes(48).toString("base64url");
  prefix = `2001:db8:${randomBytes(2).toString("hex")}`;
  metadata = new pg.Client({ connectionString: owner.toString() });
  await metadata.connect();
  connected = true;
  const origin = "https://synthetic-stage.example.com";
  const base = "http://127.0.0.1:3100";
  const env = {
    ...process.env,
    NODE_ENV: "production",
    BETTER_AUTH_URL: origin,
    BETTER_AUTH_SECRET: randomBytes(48).toString("hex"),
    AUTH_PROXY_SECRET: key,
    RUNTIME_DATABASE_URL: runtime.toString(),
    SMTP_HOST: "127.0.0.1",
    SMTP_PORT: "1025",
    SMTP_FROM: "accounts@example.com",
    SMTP_USER: "synthetic",
    SMTP_PASSWORD: "synthetic",
  };
  // Runtime must never receive the privileged fixture/migration connection.
  for (const name of [
    "DATABASE_URL",
    "TEST_DATABASE_URL",
    "TEST_RUNTIME_DATABASE_URL",
    "MIGRATION_AUDIT_DATABASE_URL",
  ])
    env[name] = ""; // Mask ignored local dotenv values in this fixture as well.
  const log = fs.openSync(
    path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), "bbd-auth-proxy-")),
      "server.log",
    ),
    "w",
    0o600,
  );
  server = spawn(
    "npm",
    ["run", "start", "--", "--hostname", "127.0.0.1", "--port", "3100"],
    { env, stdio: ["ignore", log, log], detached: true },
  );
  fs.closeSync(log);
  let ready = false;
  for (let attempt = 0; attempt < 40; attempt++) {
    if (server.exitCode !== null)
      throw new Error("Production fixture server failed");
    try {
      const response = await fetch(base + "/api/health", {
        signal: AbortSignal.timeout(2000),
      });
      if (response.ok) {
        ready = true;
        break;
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  assert.ok(ready, "Production fixture readiness");
  const call = async (endpoint, headers = {}) => {
    const response = await fetch(base + "/api/auth/" + endpoint, {
      method: "POST",
      headers: {
        Origin: origin,
        "content-type": "application/json",
        ...headers,
      },
      body: "{}",
      signal: AbortSignal.timeout(5000),
    });
    const text = await response.text();
    assert.ok(
      !text.includes(key),
      "Gateway credential must not enter responses",
    );
    return { status: response.status, headers: response.headers };
  };
  assert.equal(
    (
      await call("sign-in/email", {
        "x-forwarded-for": "198.51.100.1",
        "x-bbd-client-ip": prefix + ":1::1",
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await call("sign-in/email", {
        "x-bbd-auth-proxy-key": "wrong",
        "x-bbd-client-ip": prefix + ":1::1",
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await call("sign-in/email", {
        "x-bbd-auth-proxy-key": key,
        "x-bbd-client-ip": prefix + ":1::1, 127.0.0.1",
      })
    ).status,
    403,
  );
  console.log(
    "PASS production auth rejects missing/forged gateway credentials and ambiguous client IPs",
  );
  for (const endpoint of ["sign-in/email", "sign-up/email"]) {
    for (let attempt = 1; attempt <= 4; attempt++) {
      const response = await call(endpoint, {
        "x-bbd-auth-proxy-key": key,
        "x-bbd-client-ip": prefix + ":1::1",
        "x-forwarded-for": `2001:db8:${attempt}:abcd::1`,
        "x-real-ip": `198.51.100.${attempt}`,
        forwarded: `for=198.51.100.${attempt}`,
      });
      assert.equal(
        response.status,
        attempt === 4 ? 429 : 400,
        "Rotating untrusted IP headers must not evade the real limiter",
      );
      if (attempt === 4)
        assert.ok(Number(response.headers.get("x-retry-after")) > 0);
    }
    assert.equal(
      (
        await call(endpoint, {
          "x-bbd-auth-proxy-key": key,
          "x-bbd-client-ip": prefix + ":2::1",
        })
      ).status,
      400,
      "Independent attested client remains independent",
    );
  }
  console.log(
    "PASS production sign-in/sign-up limit shared clients and ignore spoofed forwarded headers; independent attested clients remain separate",
  );
  console.log(
    "LIMITATION shared-NAT clients intentionally share the existing rate bucket; no per-account policy or real ingress/TLS claim",
  );
} catch (error) {
  if (error && typeof error === "object")
    console.error(
      JSON.stringify({
        actualStatus:
          typeof error.actual === "number" ? error.actual : undefined,
        expectedStatus:
          typeof error.expected === "number" ? error.expected : undefined,
        location: error.stack?.match(/test-auth-proxy\.mjs:\d+:\d+/)?.[0],
      }),
    );
  console.error(
    "Production auth proxy validation failed (" +
      (error instanceof Error ? error.name : "unknown") +
      "); request and credential details suppressed.",
  );
  process.exitCode = 1;
} finally {
  if (server) {
    try {
      process.kill(-server.pid, "SIGTERM");
    } catch (error) {
      if (error.code !== "ESRCH") throw error;
    }
    await new Promise((resolve) =>
      server.exitCode !== null ? resolve() : server.once("close", resolve),
    );
  }
  if (connected) {
    try {
      await metadata.query('DELETE FROM public."RateLimit" WHERE key LIKE $1', [
        prefix + ":%",
      ]);
    } finally {
      await metadata.end();
    }
  }
}
