import { startFixtureChromium } from "./browser-fixture-chromium.mjs";
/** Local fixture only. No app config overrides, ignored TLS errors, public listener,
 * account shortcuts or new application dependencies. CA trust is private to the fixture. */
import fs from "node:fs";
import path from "node:path";
import { randomBytes, randomUUID, X509Certificate } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import https from "node:https";
import http from "node:http";
import assert from "node:assert/strict";
import { chromium } from "playwright-core";
import {
  gatewayHeaders,
  localFixtureDatabases,
} from "./browser-fixture-gateway.ts";
import { browserClientIP } from "./browser-client-ip.ts";

const requested = process.env.BBD_BROWSER_FIXTURE_DIR;
const dir = requested ?? fs.mkdtempSync("/tmp/bbd-browser-precompiled-");
assert.match(dir, /^\/tmp\/bbd-browser-precompiled-[a-zA-Z0-9]+$/);
fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
fs.chmodSync(dir, 0o700);
const save = (name, value) =>
  fs.writeFileSync(
    path.join(dir, name),
    typeof value === "string" ? value : JSON.stringify(value, null, 2),
    { mode: 0o600 },
  );
function command(binary, args) {
  const r = spawnSync(binary, args, { encoding: "utf8" });
  if (r.status !== 0)
    throw Error(
      `${binary} fixture preparation failed; no credential output retained`,
    );
  return r.stdout;
}
const ca = path.join(dir, "ca.crt"),
  caKey = path.join(dir, "ca.key"),
  cert = path.join(dir, "localhost.crt"),
  keyFile = path.join(dir, "localhost.key");
if (!fs.existsSync(ca)) {
  command("openssl", [
    "req",
    "-x509",
    "-newkey",
    "rsa:2048",
    "-noenc",
    "-days",
    "1",
    "-subj",
    "/CN=BBD local browser fixture CA",
    "-addext",
    "basicConstraints=critical,CA:TRUE,pathlen:0",
    "-addext",
    "keyUsage=critical,keyCertSign,cRLSign",
    "-keyout",
    caKey,
    "-out",
    ca,
  ]);
  command("openssl", [
    "req",
    "-newkey",
    "rsa:2048",
    "-noenc",
    "-subj",
    "/CN=localhost",
    "-keyout",
    keyFile,
    "-out",
    path.join(dir, "localhost.csr"),
  ]);
  save(
    "localhost.ext",
    "subjectAltName=DNS:localhost,IP:127.0.0.1\nbasicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\n",
  );
  command("openssl", [
    "x509",
    "-req",
    "-in",
    path.join(dir, "localhost.csr"),
    "-CA",
    ca,
    "-CAkey",
    caKey,
    "-CAcreateserial",
    "-days",
    "1",
    "-extfile",
    path.join(dir, "localhost.ext"),
    "-out",
    cert,
  ]);
}
for (const file of [caKey, keyFile]) fs.chmodSync(file, 0o600);
command("openssl", [
  "verify",
  "-CAfile",
  ca,
  "-verify_hostname",
  "localhost",
  cert,
]);
const leaf = new X509Certificate(fs.readFileSync(cert));
assert.ok(Date.parse(leaf.validTo) > Date.now());
console.log("Private fixture directory:", dir);
console.log(
  "Fixture CA fingerprint:",
  new X509Certificate(fs.readFileSync(ca)).fingerprint256,
);
if (process.argv.includes("--prepare")) {
  console.log(
    "Prepared certificates only. No host trust store was changed. The run will create an isolated private browser trust store; rerun with BBD_BROWSER_FIXTURE_DIR.",
  );
  process.exit(0);
}
assert.ok(
  fs.existsSync(".next/BUILD_ID"),
  "Run the existing production build first",
);
if (fs.existsSync(".env")) process.loadEnvFile(".env");
const { owner, runtime } = localFixtureDatabases(
  process.env.TEST_DATABASE_URL,
  process.env.TEST_RUNTIME_DATABASE_URL,
);
const run = randomUUID(),
  gatewayKey = randomBytes(48).toString("hex"),
  smtpPassword = randomBytes(32).toString("hex");
const clients = Object.fromEntries(
  [1, 2, 3, 4, 60000, 60001].map((id) => [
    browserClientIP(run, id),
    randomBytes(32).toString("hex"),
  ]),
);
save("clients.json", clients);
save("smtp-auth", `synthetic:${smtpPassword}\n`);
const host = "localhost:3443",
  origin = `https://${host}`,
  internal = "http://127.0.0.1:3200";
let server,
  isolatedChrome,
  gateway,
  mailpitCreated = false,
  browser;
let result = { status: "BLOCKED", reason: "Not completed" };
const name = `bbd-browser-mail-${run}`;
const baseEnv = {
  ...Object.fromEntries(
    Object.keys(process.env).map((k) => [
      k,
      ["PATH", "HOME", "USER", "LOGNAME", "LANG", "LC_ALL", "TMPDIR"].includes(
        k,
      )
        ? process.env[k]
        : "",
    ]),
  ),
  NODE_ENV: "production",
  RUNTIME_DATABASE_URL: runtime.toString(),
  BETTER_AUTH_URL: origin,
  BETTER_AUTH_SECRET: randomBytes(48).toString("hex"),
  AUTH_PROXY_SECRET: gatewayKey,
  NODE_EXTRA_CA_CERTS: ca,
  SMTP_HOST: "127.0.0.1",
  SMTP_PORT: "1465",
  SMTP_FROM: "accounts@example.com",
  SMTP_USER: "synthetic",
  SMTP_PASSWORD: smtpPassword,
  BBD_BROWSER_EVENT_LOOP_FILE: path.join(dir, "event-loop.jsonl"),
};
for (const k of [
  "DATABASE_URL",
  "TEST_DATABASE_URL",
  "TEST_RUNTIME_DATABASE_URL",
  "MIGRATION_AUDIT_DATABASE_URL",
  "WORKFORCE_TEST_DATABASE_URL",
  "WORKFORCE_MIGRATION_DATABASE_URL",
])
  baseEnv[k] = "";
const get = (url, headers = {}, trusted = true) =>
  new Promise((resolve, reject) => {
    const r = https.get(
      url,
      {
        ...(trusted ? { ca: fs.readFileSync(ca) } : {}),
        headers,
        rejectUnauthorized: true,
      },
      (res) => {
        res.resume();
        res.once("end", () => resolve(res.statusCode));
      },
    );
    r.setTimeout(5000, () =>
      r.destroy(Error("TLS fixture diagnostic timeout")),
    );
    r.on("error", reject);
  });
try {
  const log = fs.openSync(path.join(dir, "server.log"), "a", 0o600);
  const readiness = spawnSync(
    "node",
    ["--import", "tsx", "scripts/check-env.ts", "production"],
    { env: baseEnv, stdio: ["ignore", log, log] },
  );
  assert.equal(
    readiness.status,
    0,
    "Restricted runtime configuration/grant readiness",
  );
  server = spawn(
    "node",
    [
      "--import",
      path.resolve("scripts/browser-event-loop.mjs"),
      "node_modules/next/dist/bin/next",
      "start",
      "--hostname",
      "127.0.0.1",
      "--port",
      "3200",
    ],
    { env: baseEnv, stdio: ["ignore", log, log] },
  );
  fs.closeSync(log);
  let ready = false;
  for (let i = 0; i < 40; i++) {
    if (server.exitCode !== null) throw Error("Precompiled server exited");
    try {
      const r = await fetch(internal + "/api/health", {
        signal: AbortSignal.timeout(2000),
      });
      if (r.status === 200) {
        ready = true;
        break;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  assert.ok(ready, "Precompiled database readiness");
  const bypass = await fetch(internal + "/api/auth/get-session");
  assert.equal(
    bypass.status,
    403,
    "Direct backend must not bypass the authenticated gateway",
  );
  gateway = https.createServer(
    { key: fs.readFileSync(keyFile), cert: fs.readFileSync(cert) },
    (req, res) => {
      const headers = gatewayHeaders(req.headers, clients, gatewayKey, host);
      if (!headers) {
        res.writeHead(403, { "Cache-Control": "no-store" });
        res.end("Fixture gateway access denied");
        return;
      }
      let target;
      try {
        target = new URL(req.url, origin);
      } catch {
        res.writeHead(400);
        res.end();
        return;
      }
      if (target.origin !== origin) {
        res.writeHead(400);
        res.end();
        return;
      }
      const upstream = http.request(
        internal + target.pathname + target.search,
        { method: req.method, headers },
        (answer) => {
          res.writeHead(answer.statusCode, answer.headers);
          answer.pipe(res);
        },
      );
      req.once("aborted", () => upstream.destroy());
      res.once("close", () => upstream.destroy());
      upstream.once("error", () => {
        if (!res.headersSent) res.writeHead(502);
        res.end("Fixture upstream unavailable");
      });
      req.pipe(upstream);
    },
  );
  await new Promise((resolve, reject) => {
    gateway.once("error", reject);
    gateway.listen(3443, "127.0.0.1", resolve);
  });
  const h = { "x-bbd-fixture-client": Object.values(clients)[0] };
  await assert.rejects(
    get(origin + "/api/health", h, false),
    "Untrusted CA must be rejected",
  );
  assert.equal(
    await get(origin + "/api/health", h),
    200,
    "Verified TLS health",
  );
  assert.equal(
    await get(origin + "/api/auth/get-session", h),
    200,
    "Verified TLS gateway session readiness",
  );
  assert.equal(
    await get(origin + "/api/auth/get-session", {
      "x-forwarded-for": "127.0.0.1",
      "x-bbd-client-ip": "127.0.0.1",
      "x-bbd-auth-proxy-key": gatewayKey,
    }),
    403,
    "Caller headers must not grant a fixture identity",
  );
  // Actual Chromium trust preflight. No ignoreHTTPSErrors, SPKI exception or altered HOME.
  isolatedChrome = await startFixtureChromium(dir, ca, run);
  browser = await chromium.connectOverCDP(isolatedChrome.url);
  const ctx = await browser.newContext({ extraHTTPHeaders: h });
  try {
    const p = await ctx.newPage();
    const r = await p.goto(origin + "/api/health", { timeout: 20000 });
    assert.equal(r.status(), 200);
  } catch (error) {
    const code = String(error.message).match(/net::ERR_[A-Z_]+/)?.[0];
    save(`tls-browser-failure-${run}.json`, {
      errorName: error.name,
      networkCode: code,
      actualStatus: typeof error.actual === "number" ? error.actual : undefined,
    });
    throw Error(
      `Chromium TLS preflight failed: ${code ?? error.name}; inspect private diagnostics. Certificate checks remain enabled.`,
    );
  } finally {
    await browser.close();
    browser = undefined;
  }
  // Reuse the pinned, already installed Mailpit image; isolated capture only, no relay.
  const image =
    "axllent/mailpit:v1.29.2@sha256:030f06031ce5c60913ac9363da1ab0d4be6fd2a78147dd0e1ca0fcac665d6b34";
  command("docker", ["image", "inspect", image]); // no implicit pull/install
  command("docker", [
    "create",
    "--name",
    name,
    "--read-only",
    "--tmpfs",
    "/tmp",
    "-p",
    "127.0.0.1:1465:1025",
    "-p",
    "127.0.0.1:8026:8025",
    "--mount",
    `type=bind,source=${cert},target=/fixture/localhost.crt,readonly`,
    "--mount",
    `type=bind,source=${keyFile},target=/fixture/localhost.key,readonly`,
    "--mount",
    `type=bind,source=${dir}/smtp-auth,target=/fixture/smtp-auth,readonly`,
    image,
    "--disable-version-check",
    "--smtp-tls-cert",
    "/fixture/localhost.crt",
    "--smtp-tls-key",
    "/fixture/localhost.key",
    "--smtp-require-starttls",
    "--smtp-auth-file",
    "/fixture/smtp-auth",
    "--smtp-allowed-recipients",
    "^[a-zA-Z0-9._+-]+@example\\.com$",
  ]);
  mailpitCreated = true;
  command("docker", ["start", name]);
  let mailReady = false;
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch("http://127.0.0.1:8026/api/v1/messages");
      if (r.status === 200) {
        mailReady = true;
        break;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  assert.ok(mailReady, "Capture-only TLS SMTP service readiness");
  const browserEnv = {
    ...process.env,
    NODE_ENV: "test",
    DATABASE_URL: owner.toString(),
    RUNTIME_DATABASE_URL: runtime.toString(),
    BETTER_AUTH_URL: origin,
    BETTER_AUTH_SECRET: baseEnv.BETTER_AUTH_SECRET,
    NODE_EXTRA_CA_CERTS: ca,
    BROWSER_CDP_URL: isolatedChrome.url,
    BROWSER_FOCUS: "all",
    BROWSER_RUN_ID: run,
    BROWSER_GATEWAY_CLIENTS_FILE: path.join(dir, "clients.json"),
    BROWSER_MAILPIT_URL: "http://127.0.0.1:8026",
    BROWSER_SERVER_LOG: path.join(dir, "server.log"),
    BROWSER_ARTIFACT_DIR: path.join(dir, "artifacts"),
  };
  const out = fs.openSync(path.join(dir, "browser.log"), "a", 0o600);
  const child = spawn(
    "node",
    ["--import", "tsx", "scripts/browser-invitations.ts"],
    { env: browserEnv, stdio: ["ignore", out, out] },
  );
  fs.closeSync(out);
  const code = await new Promise((resolve) => child.once("exit", resolve));
  result = { status: code === 0 ? "PASS" : "FAIL", browserExit: code };
} catch (error) {
  result = { status: "BLOCKED", reason: error.message };
  console.error("Precompiled fixture stopped:", error.message);
  process.exitCode = 1;
} finally {
  await browser?.close();
  if (isolatedChrome) isolatedChrome.close();
  if (gateway) {
    gateway.closeAllConnections();
    await new Promise((resolve) => gateway.close(resolve));
  }
  if (server?.exitCode === null) {
    server.kill("SIGTERM");
    await new Promise((resolve) => server.once("exit", resolve));
  }
  if (mailpitCreated) command("docker", ["rm", "-f", name]); // only this run's disposable capture container, never DBs/volumes
  const outcome = { ...result, finishedAt: new Date().toISOString() };
  fs.appendFileSync(
    path.join(dir, "attempts.jsonl"),
    JSON.stringify(outcome) + "\n",
    { mode: 0o600 },
  );
  save("result.json", outcome);
  console.log("Precompiled fixture result:", result.status, "Evidence:", dir);
  if (result.status !== "PASS") process.exitCode = 1;
}
