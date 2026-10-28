import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import pg from "pg";
if (existsSync(".env")) process.loadEnvFile(".env");
const source = process.env.TEST_DATABASE_URL;
if (!source) throw new Error("TEST_DATABASE_URL is required");
const url = new URL(source),
  name = url.pathname.slice(1);
if (
  !["localhost", "127.0.0.1"].includes(url.hostname) ||
  !/^\w+_test$/.test(name)
)
  throw new Error(
    "Only a local database with an identifier ending _test is permitted",
  );
const admin = new URL(source);
admin.pathname = "/postgres";
const client = new pg.Client({ connectionString: admin.toString() });
try {
  await client.connect();
  const existing = await client.query(
    "SELECT 1 FROM pg_database WHERE datname=$1",
    [name],
  );
  if (!existing.rowCount) {
    try {
      await client.query(`CREATE DATABASE "${name}"`);
    } catch (error) {
      if (error.code !== "42P04") throw error;
    }
  }
} finally {
  await client.end();
}
const result = spawnSync("node", ["scripts/prisma-wasm.mjs", "migrate"], {
  stdio: "inherit",
  env: { ...process.env, DATABASE_URL: source },
});
if (result.status !== 0) process.exit(result.status ?? 1);
const runtime = process.env.TEST_RUNTIME_DATABASE_URL;
if (!runtime)
  throw new Error(
    "TEST_RUNTIME_DATABASE_URL is required; provision the local runtime role first",
  );
const grants = spawnSync(
  "node",
  ["--import", "tsx", "scripts/configure-local-runtime.mjs"],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      DATABASE_URL: source,
      RUNTIME_DATABASE_URL: runtime,
    },
  },
);
process.exit(grants.status ?? 1);
