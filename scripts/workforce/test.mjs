import fs from "node:fs";
import { spawnSync } from "node:child_process";
if (fs.existsSync(".env")) process.loadEnvFile(".env");
const file = "/tmp/bbd-workforce-control/environment.json";
if (!fs.existsSync(file))
  throw Error("Run the isolated workforce fixture preparation first");
const env = {
  ...process.env,
  ...JSON.parse(fs.readFileSync(file)),
  NODE_ENV: "test",
};
for (const key of [
  "WORKFORCE_TEST_DATABASE_URL",
  "WORKFORCE_RUNTIME_DATABASE_URL",
]) {
  const u = new URL(env[key]);
  if (
    !["localhost", "127.0.0.1"].includes(u.hostname) ||
    !u.pathname.endsWith("_test")
  )
    throw Error("Local isolated tests only");
}
const r = spawnSync(
  "node",
  [
    "node_modules/vitest/vitest.mjs",
    "run",
    "--config",
    "vitest.workforce.config.ts",
    ...process.argv.slice(2),
  ],
  { env, stdio: "inherit" },
);
process.exit(r.status ?? 1);
