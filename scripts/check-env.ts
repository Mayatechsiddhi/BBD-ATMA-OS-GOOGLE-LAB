import { assertRuntimeReadiness } from "../src/lib/tenant-context";
import { db } from "../src/lib/db";
import { readEnv } from "../src/lib/env";
readEnv({ ...process.env, NODE_ENV: process.argv[2] ?? "development" });
console.log(
  "Required environment configuration is valid. Values are not logged.",
);

try {
  await assertRuntimeReadiness();
} catch (error) {
  console.warn(
    "Warning: Runtime database is not reachable (" +
      (error instanceof Error ? error.message : String(error)) +
      "). Proceeding with dev startup.",
  );
} finally {
  try {
    await db.$disconnect();
  } catch {}
}
