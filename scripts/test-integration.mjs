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
if (!process.env.TEST_RUNTIME_DATABASE_URL)
  throw new Error("TEST_RUNTIME_DATABASE_URL is required");
const runtime = new URL(process.env.TEST_RUNTIME_DATABASE_URL);
if (
  runtime.hostname !== new URL(url).hostname ||
  runtime.port !== new URL(url).port ||
  runtime.pathname !== new URL(url).pathname
)
  throw new Error(
    "Runtime and fixture URLs must target the same local test database",
  );
const result = spawnSync(
  "npx",
  ["vitest", "run", "--config", "vitest.integration.config.ts"],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      DATABASE_URL: url,
      RUNTIME_DATABASE_URL: runtime.toString(),
      NODE_ENV: "test",
    },
  },
);
process.exit(result.status ?? 1);
