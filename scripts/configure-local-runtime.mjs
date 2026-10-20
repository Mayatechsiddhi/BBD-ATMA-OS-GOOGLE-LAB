/** Local-only provisioning. Never logs credentials or changes an existing password. */
import fs from "node:fs";
import { randomBytes } from "node:crypto";
import pg from "pg";
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
  const rls = await client.query(
    "SELECT to_regnamespace('bbd_private') IS NOT NULL AS ready",
  );
  if (rls.rows[0].ready) {
    await client.query(`GRANT USAGE ON SCHEMA public,bbd_private TO bbd_runtime;
   GRANT SELECT,INSERT,UPDATE ON public."User" TO bbd_runtime;
   GRANT SELECT,INSERT,UPDATE,DELETE ON public."Session",public."Account",public."Verification",public."RateLimit" TO bbd_runtime;
   GRANT SELECT ON public."Organization" TO bbd_runtime;
   GRANT UPDATE(name,"updatedAt") ON public."Organization" TO bbd_runtime;
   REVOKE UPDATE ON public."Membership" FROM bbd_runtime;
   GRANT SELECT,INSERT,DELETE ON public."Membership" TO bbd_runtime;
   GRANT UPDATE(role) ON public."Membership" TO bbd_runtime;
   GRANT SELECT,INSERT,DELETE ON public."Invitation" TO bbd_runtime;
   GRANT UPDATE("acceptedAt") ON public."Invitation" TO bbd_runtime;
   GRANT SELECT,INSERT ON public."AuditEvent" TO bbd_runtime;
   GRANT SELECT,INSERT ON public."Contact" TO bbd_runtime;
   GRANT UPDATE(name,email,company,status,"updatedAt") ON public."Contact" TO bbd_runtime;
   GRANT EXECUTE ON FUNCTION bbd_private.actor_id(),bbd_private.organization_id(),bbd_private.membership_role(text),bbd_private.invitation_recipient(text,text),bbd_private.create_organization(text,text,text) TO bbd_runtime;`);
  }
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
    rls.rows[0].ready
      ? "Local runtime role verified and scoped privileges granted."
      : "Local runtime role prepared. Apply migration, then rerun for grants.",
  );
} catch (error) {
  console.error("Local runtime provisioning failed:", error.code ?? error.name);
  process.exitCode = 1;
} finally {
  await client.end();
}
