/** Local isolated fixture runner; never points the suite at the application DB. */
import fs from "node:fs";
import { spawnSync } from "node:child_process";
if (fs.existsSync(".env")) process.loadEnvFile(".env");
const source = process.env.DATABASE_URL;
if (!source || !["localhost", "127.0.0.1"].includes(new URL(source).hostname))
  throw new Error(
    "Privilege fixtures require a local administrative connection",
  );
const result = spawnSync(
  "npx",
  ["vitest", "run", "--config", "vitest.privileges.config.ts"],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      NODE_ENV: "test",
      PRIVILEGE_FIXTURE_ADMIN_URL: source,
    },
  },
);
process.exit(result.status ?? 1);
