/** Read-only metadata audit; no credential values or application rows emitted. */
import fs from "node:fs";
import pg from "pg";
import { runtimePrivilegeAuditSQL } from "../src/lib/runtime-privileges.ts";
if (fs.existsSync(".env")) process.loadEnvFile(".env");
const source = process.env.RUNTIME_DATABASE_URL;
if (!source || !["localhost", "127.0.0.1"].includes(new URL(source).hostname))
  throw new Error("Runtime audit is local-only");
const client = new pg.Client({ connectionString: source });
try {
  await client.connect();
  const found = await client.query(runtimePrivilegeAuditSQL("session_user"));
  console.log(JSON.stringify({ findings: found.rows }, null, 2));
  if (found.rowCount) process.exitCode = 1;
} catch {
  console.error("Runtime metadata audit failed; no credentials logged.");
  process.exitCode = 1;
} finally {
  await client.end();
}
