import type pg from "pg";
import {
  identifier,
  runtimeFunctions,
  runtimePrivilegeAuditSQL,
  runtimeTables,
} from "../src/lib/runtime-privileges";

/** Caller supplies a migration connection. No role alteration or REVOKE.
 * Unexpected ACLs/owners/PUBLIC access abort the transaction before any GRANT.
 * Missing objects are allowed during initial pre-migration setup only.
 */
export async function enforceRuntimePrivileges(
  client: pg.Client,
  role: string,
) {
  if (!["localhost", "127.0.0.1"].includes(client.host))
    throw new Error("Runtime provisioning is local-only");
  await client.query("BEGIN");
  try {
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtextextended(current_database() || ':runtime-grants',0))",
    );
    const check = async () => {
      const found = await client.query(runtimePrivilegeAuditSQL("$1"), [role]);
      if (found.rowCount)
        throw new Error(
          "Runtime privilege drift detected; no grants changed. Review object/role ACLs explicitly.",
        );
    };
    const exists = await client.query(
      "SELECT 1 FROM pg_roles WHERE rolname=$1",
      [role],
    );
    if (!exists.rowCount) throw new Error("Runtime role must already exist");
    await check();
    const schemas = await client.query(
      "SELECT nspname FROM pg_namespace WHERE nspname IN ('public','bbd_private')",
    );
    for (const { nspname } of schemas.rows)
      await client.query(
        `GRANT USAGE ON SCHEMA ${identifier(nspname)} TO ${identifier(role)}`,
      );
    for (const [table, policy] of Object.entries(runtimeTables)) {
      const relation = "public." + identifier(table);
      const present = await client.query("SELECT to_regclass($1) AS relation", [
        relation,
      ]);
      if (!present.rows[0].relation) continue;
      await client.query(
        `GRANT ${policy.privileges.join(",")} ON TABLE ${relation} TO ${identifier(role)}`,
      );
      if (policy.update)
        await client.query(
          `GRANT UPDATE (${policy.update.map(identifier).join(",")}) ON TABLE ${relation} TO ${identifier(role)}`,
        );
    }
    for (const signature of runtimeFunctions) {
      const name = "bbd_private." + signature;
      const present = await client.query(
        "SELECT to_regprocedure($1) AS function",
        [name],
      );
      if (present.rows[0].function)
        await client.query(
          `GRANT EXECUTE ON FUNCTION ${name} TO ${identifier(role)}`,
        );
    }
    await check();
    await client.query("COMMIT");
    return schemas.rows.some((r) => r.nspname === "bbd_private");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}
