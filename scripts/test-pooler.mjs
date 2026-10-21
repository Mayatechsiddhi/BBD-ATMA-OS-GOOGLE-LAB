/** Local-only, ephemeral PgBouncer; never resets or drops a database. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import pg from "pg";
if (existsSync(".env")) process.loadEnvFile(".env");
const fixture = new URL(process.env.TEST_DATABASE_URL);
const runtime = new URL(process.env.TEST_RUNTIME_DATABASE_URL);
for (const url of [fixture, runtime])
  if (
    !["localhost", "127.0.0.1"].includes(url.hostname) ||
    !/^\/\w+_test$/.test(url.pathname)
  )
    throw new Error("Pooler tests require dedicated local test databases");
assert.equal(fixture.pathname, runtime.pathname);
assert.equal(runtime.username, "bbd_runtime");
const password = decodeURIComponent(runtime.password);
assert.match(password, /^[a-f0-9]+$/);
const image =
  "edoburu/pgbouncer@sha256:a26a00a576e248e73230eff35c8fbe77279bf0d8b6550d3007c56ee69287c664";
const name = `bbd-pooler-test-${randomUUID()}`;
const port = 6432;
function docker(args, input) {
  const result = spawnSync("docker", args, {
    input,
    encoding: "utf8",
    timeout: 120000,
  });
  if (result.status !== 0)
    throw new Error(
      `Docker ${args[0]} failed (exit ${result.status}); no credentials logged`,
    );
  return result.stdout.trim();
}
let created = false;
try {
  docker([
    "create",
    "--name",
    name,
    "--network",
    "bbd-atma-dev_default",
    "-p",
    `127.0.0.1:${port}:${port}`,
    "--entrypoint",
    "/bin/sh",
    image,
    "-c",
    "exec tail -f /dev/null",
  ]);
  created = true;
  docker(["start", name]);
  const version = docker(["exec", name, "pgbouncer", "--version"]).split(
    "\n",
  )[0];
  assert.equal(version, "PgBouncer 1.26.1");
  const config = `[databases]\n${runtime.pathname.slice(1)} = host=postgres port=5432 dbname=${runtime.pathname.slice(1)}\n[pgbouncer]\nlisten_addr = 0.0.0.0\nlisten_port = ${port}\nunix_socket_dir = /tmp\nauth_type = scram-sha-256\nauth_file = /tmp/bbd-users.txt\npool_mode = transaction\ndefault_pool_size = 1\nreserve_pool_size = 0\nmax_client_conn = 50\nmax_prepared_statements = 100\nadmin_users = bbd_runtime\npidfile = /tmp/bbd-pooler.pid\nlogfile = /tmp/bbd-pooler.log\nlog_connections = 0\nlog_disconnections = 0\n`;
  docker(
    ["exec", "-i", name, "sh", "-c", "umask 077; cat > /tmp/bbd-users.txt"],
    `"bbd_runtime" "${password}"\n`,
  );
  docker(
    ["exec", "-i", name, "sh", "-c", "umask 077; cat > /tmp/bbd-pooler.ini"],
    config,
  );
  docker(["exec", name, "pgbouncer", "-d", "/tmp/bbd-pooler.ini"]);
  runtime.hostname = "127.0.0.1";
  runtime.port = String(port);
  const consoleURL = new URL(runtime);
  consoleURL.pathname = "/pgbouncer";
  const consoleClient = new pg.Client({
    connectionString: consoleURL.toString(),
  });
  try {
    await consoleClient.connect();
    const rows = (await consoleClient.query("SHOW CONFIG")).rows;
    assert.equal(rows.find((r) => r.key === "pool_mode").value, "transaction");
    assert.equal(rows.find((r) => r.key === "default_pool_size").value, "1");
  } finally {
    await consoleClient.end();
  }
  console.log(
    `${version}: verified transaction mode, one server connection, SCRAM authentication, prepared statement tracking enabled.`,
  );
  const tests = spawnSync(
    "npx",
    ["vitest", "run", "--config", "vitest.integration.config.ts"],
    {
      stdio: "inherit",
      env: {
        ...process.env,
        DATABASE_URL: fixture.toString(),
        RUNTIME_DATABASE_URL: runtime.toString(),
        NODE_ENV: "test",
      },
    },
  );
  if (tests.status !== 0) process.exitCode = tests.status ?? 1;
  else
    console.log(
      "Pooler regression suite passed through actual PgBouncer; fixture administration remained direct. No provider pooler or statement pooling is claimed.",
    );
} finally {
  if (created) docker(["rm", "-f", name]);
}
