/** Read-only deployment preflight. Never provisions/revokes roles or runs DDL. */
import fs from "node:fs";
import pg from "pg";
import {
  expectedMigrations,
  migrationReadiness,
} from "./database-readiness.ts";
if (fs.existsSync(".env")) process.loadEnvFile(".env");
let runtimeURL, auditURL;
try {
  runtimeURL = new URL(process.env.RUNTIME_DATABASE_URL);
  auditURL = new URL(process.env.MIGRATION_AUDIT_DATABASE_URL);
  if (
    ![runtimeURL, auditURL].every(
      (url) =>
        ["postgresql:", "postgres:"].includes(url.protocol) && url.username,
    )
  )
    throw new Error("Explicit PostgreSQL identities required");
  if (
    runtimeURL.hostname !== auditURL.hostname ||
    runtimeURL.port !== auditURL.port ||
    runtimeURL.pathname !== auditURL.pathname
  )
    throw new Error("Endpoint/database mismatch");
  if (
    !["localhost", "127.0.0.1"].includes(runtimeURL.hostname) &&
    [runtimeURL, auditURL].some(
      (url) => url.searchParams.get("sslmode") !== "verify-full",
    )
  )
    throw new Error("Certificate-verified PostgreSQL TLS required");
} catch {
  console.error(
    JSON.stringify({
      status: "not-ready",
      errorType: "ConfigurationError",
      readOnly: true,
    }),
  );
  process.exit(1);
}
let runtime,
  metadata,
  connected = false;
try {
  const { assertRuntimeDatabase } =
    await import("../src/lib/tenant-context.ts");
  const { runtimeRequiredPrivilegesSQL } =
    await import("../src/lib/runtime-privileges.ts");
  const { Prisma } = await import("../src/generated/prisma/client.ts");
  runtime = (await import("../src/lib/db.ts")).db;
  // Keep privileged metadata credentials out of the application process. The
  // separate metadata login needs SELECT on _prisma_migrations, not runtime grants.
  metadata = new pg.Client({ connectionString: auditURL.toString() });
  const missing = await runtime.$transaction(async (tx) => {
    await tx.$executeRaw`SET TRANSACTION READ ONLY`;
    await assertRuntimeDatabase(tx);
    return tx.$queryRaw(
      Prisma.raw(runtimeRequiredPrivilegesSQL("session_user")),
    );
  });
  await metadata.connect();
  connected = true;
  await metadata.query("BEGIN READ ONLY");
  const rows = (
    await metadata.query(
      'SELECT migration_name,checksum,finished_at,rolled_back_at FROM public."_prisma_migrations" ORDER BY started_at',
    )
  ).rows;
  const expected = expectedMigrations();
  const issues = migrationReadiness(rows, expected);
  await metadata.query("ROLLBACK");
  if (issues.length || missing.length) {
    console.error(
      JSON.stringify({
        status: "not-ready",
        missingRequired: missing,
        incompatibleMigrations: issues,
        readOnly: true,
      }),
    );
    process.exitCode = 1;
  } else
    console.log(
      JSON.stringify({
        status: "ready",
        migrations: Object.keys(expected).length,
        runtime: "restricted login; RLS/excess and required grants verified",
        readOnly: true,
      }),
    );
} catch (error) {
  console.error(
    JSON.stringify({
      status: "not-ready",
      errorType: error instanceof Error ? error.name : "unknown",
      readOnly: true,
    }),
  );
  process.exitCode = 1;
} finally {
  if (connected) await metadata.end();
  if (runtime) await runtime.$disconnect();
}
