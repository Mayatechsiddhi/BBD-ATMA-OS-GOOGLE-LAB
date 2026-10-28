/** Local-only provisioning. Never logs credentials or changes an existing password. */
import fs from "node:fs";
import { randomBytes } from "node:crypto";
import pg from "pg";
import { enforceRuntimePrivileges } from "./runtime-privileges.ts";
if (fs.existsSync(".env")) process.loadEnvFile(".env");
const source = process.env.DATABASE_URL;
if (!source) throw new Error("Local migration DATABASE_URL required");
const owner = new URL(source);
if (!["localhost", "127.0.0.1"].includes(owner.hostname))
  throw new Error("Runtime provisioning is local-only");
const role = "bbd_runtime";
const runtime = process.env.RUNTIME_DATABASE_URL
  ? new URL(process.env.RUNTIME_DATABASE_URL)
  : new URL(source);
if (!process.env.RUNTIME_DATABASE_URL) {
  runtime.username = role;
  runtime.password = randomBytes(32).toString("hex");
}
if (
  runtime.username !== role ||
  runtime.hostname !== owner.hostname ||
  runtime.port !== owner.port ||
  runtime.pathname !== owner.pathname
)
  throw new Error(
    "Runtime URL must use the dedicated local bbd_runtime role and same database",
  );
const client = new pg.Client({ connectionString: source });
await client.connect();
try {
  const existing = await client.query(
    "SELECT rolsuper,rolbypassrls,rolcreatedb,rolcreaterole,EXISTS(SELECT 1 FROM pg_auth_members WHERE member=pg_roles.oid) AS memberships FROM pg_roles WHERE rolname=$1",
    [role],
  );
  if (!existing.rowCount) {
    await client.query(
      `CREATE ROLE bbd_runtime LOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE PASSWORD ${pg.escapeLiteral(decodeURIComponent(runtime.password))}`,
    );
  } else {
    if (Object.values(existing.rows[0]).some(Boolean))
      throw new Error("Existing runtime role is unsafe; not altered");
    const probe = new pg.Client({ connectionString: runtime.toString() });
    try {
      await probe.connect();
    } finally {
      await probe.end();
    }
  }
  const ready = await enforceRuntimePrivileges(client, role);
  if (!process.env.RUNTIME_DATABASE_URL)
    fs.appendFileSync(
      ".env",
      `\nRUNTIME_DATABASE_URL=${JSON.stringify(runtime.toString())}\n`,
    );
  if (!process.env.TEST_RUNTIME_DATABASE_URL && process.env.TEST_DATABASE_URL) {
    const test = new URL(process.env.TEST_DATABASE_URL);
    if (
      test.hostname !== owner.hostname ||
      test.port !== owner.port ||
      !test.pathname.endsWith("_test")
    )
      throw new Error("Dedicated local test URL required");
    test.username = role;
    test.password = runtime.password;
    fs.appendFileSync(
      ".env",
      `TEST_RUNTIME_DATABASE_URL=${JSON.stringify(test.toString())}\n`,
    );
  }
  console.log(
    ready
      ? "Local runtime role verified and scoped privileges granted."
      : "Local runtime role prepared. Apply migration, then rerun for grants.",
  );
} catch (error) {
  console.error("Local runtime provisioning failed:", error.code ?? error.name);
  process.exitCode = 1;
} finally {
  await client.end();
}
