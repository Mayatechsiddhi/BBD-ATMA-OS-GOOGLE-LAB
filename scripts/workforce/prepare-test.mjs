/** Local isolated fixtures only. No production provisioning or blind revocation. */
import fs from "node:fs";
import pg from "pg";
import { randomBytes, createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { workforceGrants } from "../../src/modules/workforce-control-plane/privileges.ts";
import {
  workforceDatabase,
  assertWorkforceRuntime,
} from "../../src/modules/workforce-control-plane/database.ts";
if (fs.existsSync(".env")) process.loadEnvFile(".env");
const source = new URL(process.env.DATABASE_URL);
if (!["localhost", "127.0.0.1"].includes(source.hostname))
  throw Error("Local fixture admin only");
source.pathname = "/postgres";
const dir = "/tmp/bbd-workforce-control";
fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
const file = dir + "/credentials.json";
if (!fs.existsSync(file))
  fs.writeFileSync(
    file,
    JSON.stringify({
      owner: randomBytes(32).toString("hex"),
      runtime: randomBytes(32).toString("hex"),
      secret: randomBytes(48).toString("hex"),
    }),
    { mode: 0o600, flag: "wx" },
  );
const secrets = JSON.parse(fs.readFileSync(file));
const name = process.env.WORKFORCE_FIXTURE_NAME ?? "bbd_workforce_durable_test";
if (!/^bbd_workforce_[a-z0-9_]+_test$/.test(name) || name.length > 45)
  throw Error("Isolated workforce test name required");
const owner = name + "_owner",
  runtime = name + "_runtime";
const admin = new pg.Client({ connectionString: source.toString() });
await admin.connect();
try {
  for (const [role, password] of [
    [owner, secrets.owner],
    [runtime, secrets.runtime],
  ]) {
    const r = await admin.query(
      "SELECT rolsuper,rolbypassrls,rolcreatedb,rolcreaterole,rolreplication,NOT rolcanlogin AS disabled,EXISTS(SELECT 1 FROM pg_auth_members WHERE member=pg_roles.oid) AS membership FROM pg_roles WHERE rolname=$1",
      [role],
    );
    if (!r.rowCount)
      await admin.query(
        `CREATE ROLE ${pg.escapeIdentifier(role)} LOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE PASSWORD ${pg.escapeLiteral(password)}`,
      );
    else if (Object.values(r.rows[0]).some(Boolean))
      throw Error("Existing fixture role unsafe; left unchanged");
  }
  const r = await admin.query(
    "SELECT pg_get_userbyid(datdba) AS owner FROM pg_database WHERE datname=$1",
    [name],
  );
  if (!r.rowCount)
    await admin.query(
      `CREATE DATABASE ${pg.escapeIdentifier(name)} OWNER ${pg.escapeIdentifier(owner)}`,
    );
  else if (r.rows[0].owner !== owner)
    throw Error("Existing fixture owner mismatch");
  await admin.query(
    `REVOKE CONNECT,TEMPORARY ON DATABASE ${pg.escapeIdentifier(name)} FROM PUBLIC`,
  );
  await admin.query(
    `GRANT CONNECT ON DATABASE ${pg.escapeIdentifier(name)} TO ${pg.escapeIdentifier(runtime)}`,
  );
} finally {
  await admin.end();
}
const migration = new URL(source);
migration.pathname = "/" + name;
migration.username = owner;
migration.password = secrets.owner;
migration.searchParams.delete("options");
const app = new URL(migration);
app.username = runtime;
app.password = secrets.runtime;
const env = {
  ...process.env,
  DATABASE_URL: migration.toString(),
  PRISMA_SCHEMA_PATH: "prisma/workforce/schema.prisma",
};
for (let n = 0; n < 2; n++) {
  const r = spawnSync("node", ["scripts/prisma-wasm.mjs", "migrate"], {
    env,
    stdio: "inherit",
  });
  if (r.status) process.exit(r.status ?? 1);
}
const provision = new pg.Client({ connectionString: migration.toString() });
await provision.connect();
try {
  const role = await provision.query(
    "SELECT current_user=r.rolname AS login,rolsuper,rolbypassrls FROM pg_roles r WHERE r.rolname=session_user",
  );
  if (
    !role.rows[0]?.login ||
    role.rows[0].rolsuper ||
    role.rows[0].rolbypassrls
  )
    throw Error(
      "Migration owner must be independently authenticated and restricted",
    );
  const applied = await provision.query(
    'SELECT migration_name,checksum FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL',
  );
  for (const row of applied.rows) {
    const sql = fs.readFileSync(
      `prisma/workforce/migrations/${row.migration_name}/migration.sql`,
    );
    if (createHash("sha256").update(sql).digest("hex") !== row.checksum)
      throw Error(
        "Workforce fixture migration checksum drift; do not reset or overwrite",
      );
  }
  // Before adding missing reviewed grants, reject dangerous existing table ACLs.
  const excessive = await provision.query(
    `SELECT c.relname FROM pg_class c WHERE c.relnamespace='public'::regnamespace AND c.relkind='r' AND (has_table_privilege($1,c.oid,'TRUNCATE') OR has_table_privilege($1,c.oid,'TRIGGER') OR has_table_privilege($1,c.oid,'REFERENCES') OR (c.relname LIKE 'Workforce%' AND (has_table_privilege($1,c.oid,'INSERT') OR has_table_privilege($1,c.oid,'UPDATE') OR has_table_privilege($1,c.oid,'DELETE'))))`,
    [runtime],
  );
  if (excessive.rowCount)
    throw Error("Fixture runtime grant drift; left unchanged");
  await provision.query(workforceGrants(runtime));
  const functions = await provision.query(
    "SELECT count(*)::int AS count FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='wf_private' AND pg_get_userbyid(p.proowner)=$1 AND p.prosecdef",
    [owner],
  );
  if (functions.rows[0].count !== 2)
    throw Error("Unexpected workforce function owners");
  const tables = await provision.query(
    `SELECT count(*)::int AS count FROM pg_class WHERE relnamespace='public'::regnamespace AND relkind='r' AND relname <> '_prisma_migrations' AND pg_get_userbyid(relowner)=$1`,
    [owner],
  );
  if (tables.rows[0].count !== 10)
    throw Error("Unexpected workforce table ownership");
} finally {
  await provision.end();
}
fs.writeFileSync(
  dir + "/environment.json",
  JSON.stringify({
    WORKFORCE_TEST_DATABASE_URL: migration.toString(),
    WORKFORCE_RUNTIME_DATABASE_URL: app.toString(),
    WORKFORCE_AUTH_SECRET: secrets.secret,
    WORKFORCE_AUTH_URL: "http://localhost:3100",
    WORKFORCE_TEST_RUNTIME_ROLE: runtime,
  }),
  { mode: 0o600 },
);
process.env.WORKFORCE_RUNTIME_DATABASE_URL = app.toString();
const verify = workforceDatabase();
try {
  await verify.$transaction(assertWorkforceRuntime);
} finally {
  await verify.$disconnect();
}
console.log(
  "Separate workforce test database: additive migration applied twice, restricted owner authenticated, reviewed runtime grants provisioned. No customer migrations executed.",
);
