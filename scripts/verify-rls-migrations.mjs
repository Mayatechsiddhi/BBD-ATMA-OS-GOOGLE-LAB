/** No reset/drop: apply twice on a dedicated local DB owned by a non-superuser. */
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import pg from "pg";
if (fs.existsSync(".env")) process.loadEnvFile(".env");
const source = process.env.DATABASE_URL;
if (!source || !process.env.RUNTIME_DATABASE_URL)
  throw new Error("Local migration/runtime configuration required");
const url = new URL(source);
if (!["localhost", "127.0.0.1"].includes(url.hostname))
  throw new Error("Migration verification is local-only");
url.pathname = "/postgres";
const admin = new pg.Client({ connectionString: url.toString() });
await admin.connect();
const name = "bbd_rls_migration_test",
  owner = "bbd_migration_test_owner";
let created = false;
try {
  const roles = await admin.query(
    "SELECT rolsuper,rolbypassrls,rolcreaterole,rolcreatedb FROM pg_roles WHERE rolname=$1",
    [owner],
  );
  if (!roles.rowCount)
    await admin.query(
      "CREATE ROLE bbd_migration_test_owner NOLOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE",
    );
  else if (Object.values(roles.rows[0]).some(Boolean))
    throw new Error("Existing migration test role unsafe; left unchanged");
  const existing = await admin.query(
    "SELECT pg_get_userbyid(datdba) AS owner FROM pg_database WHERE datname=$1",
    [name],
  );
  if (!existing.rowCount) {
    await admin.query(
      "CREATE DATABASE bbd_rls_migration_test OWNER bbd_migration_test_owner",
    );
    created = true;
  } else if (existing.rows[0].owner !== owner)
    throw new Error(
      "Existing test database has an unexpected owner; left unchanged",
    );
} finally {
  await admin.end();
}
const migration = new URL(source);
migration.pathname = "/" + name;
migration.searchParams.set("options", "-c role=" + owner);
const runtime = new URL(process.env.RUNTIME_DATABASE_URL);
runtime.pathname = "/" + name;
runtime.searchParams.delete("options");
const env = {
  ...process.env,
  DATABASE_URL: migration.toString(),
  RUNTIME_DATABASE_URL: runtime.toString(),
  TEST_DATABASE_URL: migration.toString(),
  TEST_RUNTIME_DATABASE_URL: runtime.toString(),
};
const probe = new pg.Client({ connectionString: migration.toString() });
try {
  await probe.connect();
  const {
    rows: [actual],
  } = await probe.query(
    "SELECT current_user,rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user",
  );
  if (actual.current_user !== owner || actual.rolsuper || actual.rolbypassrls)
    throw new Error(
      "Migration verification did not assume the unprivileged effective owner role",
    );
  console.log("Verified non-superuser/non-bypass effective migration owner.");
} finally {
  await probe.end();
}
for (const args of [
  ["scripts/prisma-wasm.mjs", "migrate"],
  ["scripts/prisma-wasm.mjs", "migrate"],
  ["scripts/configure-local-runtime.mjs"],
  ["scripts/test-integration.mjs"],
]) {
  const result = spawnSync("node", args, { stdio: "inherit", env });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
const ownership = new pg.Client({ connectionString: migration.toString() });
try {
  await ownership.connect();
  const tables = await ownership.query(
    `SELECT pg_get_userbyid(relowner) AS owner FROM pg_class WHERE oid IN ('public."Organization"'::regclass,'public."Membership"'::regclass,'public."Invitation"'::regclass,'public."AuditEvent"'::regclass,'public."Contact"'::regclass)`,
  );
  if (tables.rowCount !== 5 || tables.rows.some((r) => r.owner !== owner))
    throw new Error("Unexpected table owners in migration verification");
  const funcs = await ownership.query(
    "SELECT pg_get_userbyid(p.proowner) AS owner FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='bbd_private' AND p.prosecdef",
  );
  if (funcs.rowCount !== 2 || funcs.rows.some((r) => r.owner !== owner))
    throw new Error("Unexpected security-definer owners");
  console.log(
    "Verified all tenant tables and both security-definer functions owned by the non-superuser test role.",
  );
} finally {
  await ownership.end();
}
console.log(
  `Non-superuser migration verification passed (new dedicated database: ${created}). Existing databases and migrations preserved.`,
);
