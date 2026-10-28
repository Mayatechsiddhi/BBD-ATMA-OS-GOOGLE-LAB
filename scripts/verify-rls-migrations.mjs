/** No reset/drop: apply twice on a dedicated local DB owned by a non-superuser. */
import fs from "node:fs";
import { randomBytes } from "node:crypto";
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
// Separate login and database: preserve the older SET ROLE verification database.
const name = "bbd_clinic_migration_test",
  owner = "bbd_login_migration_test_owner";
const credentialFile = ".env.migration-test";
if (!fs.existsSync(credentialFile))
  fs.writeFileSync(
    credentialFile,
    JSON.stringify({ password: randomBytes(32).toString("hex") }),
    { mode: 0o600, flag: "wx" },
  );
const { password } = JSON.parse(fs.readFileSync(credentialFile, "utf8"));
if (typeof password !== "string" || !/^[a-f0-9]{64}$/.test(password))
  throw new Error("Invalid ignored local migration-test credential file");
let created = false;
try {
  const roles = await admin.query(
    "SELECT rolsuper,rolbypassrls,rolcreaterole,rolcreatedb,NOT rolcanlogin AS no_login,EXISTS(SELECT 1 FROM pg_auth_members WHERE member=pg_roles.oid) AS memberships FROM pg_roles WHERE rolname=$1",
    [owner],
  );
  if (!roles.rowCount)
    await admin.query(
      `CREATE ROLE bbd_login_migration_test_owner LOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE PASSWORD ${pg.escapeLiteral(password)}`,
    );
  else if (Object.values(roles.rows[0]).some(Boolean))
    throw new Error("Existing migration test role unsafe; left unchanged");
  const existing = await admin.query(
    "SELECT pg_get_userbyid(datdba) AS owner FROM pg_database WHERE datname=$1",
    [name],
  );
  if (!existing.rowCount) {
    await admin.query(
      `CREATE DATABASE ${pg.escapeIdentifier(name)} OWNER ${pg.escapeIdentifier(owner)}`,
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
migration.username = owner;
migration.password = password;
migration.searchParams.delete("options");
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
    "SELECT current_user,session_user,rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user",
  );
  if (
    actual.current_user !== owner ||
    actual.session_user !== owner ||
    actual.rolsuper ||
    actual.rolbypassrls
  )
    throw new Error(
      "Migration verification did not authenticate as the restricted migration login",
    );
  console.log(
    "Verified independently authenticated non-superuser/non-bypass migration login (current_user = session_user).",
  );
} finally {
  await probe.end();
}
for (const args of [
  ["scripts/prisma-wasm.mjs", "migrate"],
  ["scripts/prisma-wasm.mjs", "migrate"],
  ["--import", "tsx", "scripts/configure-local-runtime.mjs"],
  ["scripts/test-integration.mjs"],
]) {
  const result = spawnSync("node", args, { stdio: "inherit", env });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
const ownership = new pg.Client({ connectionString: migration.toString() });
try {
  await ownership.connect();
  const tables = await ownership.query(
    `SELECT pg_get_userbyid(relowner) AS owner FROM pg_class WHERE oid IN ('public."Organization"'::regclass,'public."Membership"'::regclass,'public."Invitation"'::regclass,'public."AuditEvent"'::regclass,'public."Contact"'::regclass,'public."ClinicLead"'::regclass,'public."Appointment"'::regclass,'public."FollowUp"'::regclass)`,
  );
  if (tables.rowCount !== 8 || tables.rows.some((r) => r.owner !== owner))
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
