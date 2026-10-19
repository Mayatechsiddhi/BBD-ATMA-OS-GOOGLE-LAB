import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
if (existsSync(".env")) process.loadEnvFile(".env");
const url = process.env.TEST_DATABASE_URL;
if (
  !url ||
  !new URL(url).pathname.endsWith("_test") ||
  !["localhost", "127.0.0.1"].includes(new URL(url).hostname)
)
  throw new Error(
    "TEST_DATABASE_URL must name a dedicated database ending in _test. Apply migrations there first.",
  );
const result = spawnSync(
  "npx",
  ["vitest", "run", "--config", "vitest.integration.config.ts"],
  {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: url, NODE_ENV: "test" },
  },
);
process.exit(result.status ?? 1);
