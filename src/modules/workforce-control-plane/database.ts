import { PrismaClient, type Prisma } from "@/generated/workforce/client";
import { PrismaPg } from "@prisma/adapter-pg";
import {
  databasePoolOptions,
  tenantTransactionOptions,
} from "@/lib/database-options";
import { workforceTables, workforceAuthTables } from "./privileges";

export function workforceDatabase() {
  if (
    process.env.NODE_ENV === "production" &&
    [
      "DATABASE_URL",
      "RUNTIME_DATABASE_URL",
      "WORKFORCE_MIGRATION_DATABASE_URL",
      "WORKFORCE_TEST_DATABASE_URL",
      "TEST_DATABASE_URL",
      "TEST_RUNTIME_DATABASE_URL",
    ].some((key) => process.env[key])
  )
    throw new Error(
      "Isolated workforce process must not receive customer or migration credentials",
    );
  const url = process.env.WORKFORCE_RUNTIME_DATABASE_URL;
  if (!url) throw new Error("Separate WORKFORCE_RUNTIME_DATABASE_URL required");
  const parsed = new URL(url);
  if (
    process.env.NODE_ENV === "production" &&
    parsed.searchParams.get("sslmode") !== "verify-full"
  )
    throw new Error("Workforce production database requires verified TLS");
  for (const key of [
    "DATABASE_URL",
    "RUNTIME_DATABASE_URL",
    "TEST_DATABASE_URL",
    "TEST_RUNTIME_DATABASE_URL",
  ]) {
    if (process.env[key]) {
      const customer = new URL(process.env[key]!);
      if (
        customer.hostname === parsed.hostname &&
        customer.pathname === parsed.pathname
      )
        throw new Error(
          "Workforce storage must be separate from customer storage",
        );
    }
  }
  return new PrismaClient({
    adapter: new PrismaPg({ connectionString: url, ...databasePoolOptions() }),
  });
}

export async function assertWorkforceRuntime(tx: Prisma.TransactionClient) {
  const [role] = await tx.$queryRaw<
    {
      unsafe: boolean;
      protected: number;
      customer: boolean;
      functionDrift: boolean;
    }[]
  >`
    SELECT (r.rolsuper OR r.rolbypassrls OR r.rolcreatedb OR r.rolcreaterole OR r.rolreplication
      OR EXISTS (SELECT 1 FROM pg_auth_members WHERE member=r.oid)
      OR EXISTS(SELECT 1 FROM pg_proc p WHERE p.pronamespace='wf_private'::regnamespace AND pg_has_role(current_user,p.proowner,'MEMBER'))
      OR has_database_privilege(current_user,current_database(),'TEMP')
      OR has_schema_privilege(current_user,'public','CREATE') OR has_schema_privilege(current_user,'wf_private','CREATE')
      OR EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','wf_private') AND pg_has_role(current_user,c.relowner,'MEMBER'))
      OR EXISTS (SELECT 1 FROM pg_database d WHERE d.datname=current_database() AND pg_has_role(current_user,d.datdba,'MEMBER'))
    ) AS unsafe,
    (SELECT count(*)::int FROM pg_class WHERE relname IN ('WorkforceCompany','WorkforceMember','WorkforceTask','WorkforceReceipt','WorkforceAudit') AND relnamespace='public'::regnamespace AND relrowsecurity AND relforcerowsecurity) AS protected,
    (to_regclass('public."Contact"') IS NOT NULL OR to_regclass('public."Organization"') IS NOT NULL) AS customer,
    EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='wf_private' AND
      (EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.grantee=0 AND a.privilege_type='EXECUTE') OR (has_function_privilege(current_user,p.oid,'EXECUTE') AND p.proname NOT IN ('visible','dispatch')))) AS "functionDrift"
    FROM pg_roles r WHERE r.rolname=current_user`;
  if (
    !role ||
    role.unsafe ||
    role.protected !== 5 ||
    role.customer ||
    role.functionDrift
  )
    throw new Error("Unsafe workforce runtime database");
  const [acl] = await tx.$queryRaw<{ unsafe: boolean }[]>`
    SELECT EXISTS(SELECT 1 FROM pg_class c CROSS JOIN LATERAL aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a
     WHERE c.relnamespace='public'::regnamespace AND (a.grantee=0 OR (a.grantee=(SELECT oid FROM pg_roles WHERE rolname=current_user) AND a.is_grantable)))
     OR EXISTS(SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE p.pronamespace='wf_private'::regnamespace AND (a.grantee=0 OR (a.grantee=(SELECT oid FROM pg_roles WHERE rolname=current_user) AND a.is_grantable))) OR EXISTS(SELECT 1 FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid CROSS JOIN LATERAL aclexplode(CASE WHEN cardinality(a.attacl)>0 THEN a.attacl END) x
      WHERE c.relnamespace='public'::regnamespace AND (x.grantee=0 OR (x.grantee=(SELECT oid FROM pg_roles WHERE rolname=current_user) AND x.is_grantable))) AS unsafe`;
  if (acl.unsafe) throw new Error("Unsafe workforce public/grant-option ACL");
  const permissions = await tx.$queryRaw<
    { name: string; privilege: string; allowed: boolean }[]
  >`
    SELECT c.relname AS name,p.privilege,has_table_privilege(current_user,c.oid,p.privilege) AS allowed
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    CROSS JOIN (VALUES ('SELECT'),('INSERT'),('UPDATE'),('DELETE'),('TRUNCATE'),('REFERENCES'),('TRIGGER')) p(privilege)
    WHERE n.nspname='public' AND c.relkind='r'`;
  for (const row of permissions) {
    const expected = (workforceAuthTables as readonly string[]).includes(
      row.name,
    )
      ? ["SELECT", "INSERT", "UPDATE", "DELETE"].includes(row.privilege)
      : (workforceTables as readonly string[]).includes(row.name) &&
        row.privilege === "SELECT";
    if (row.allowed !== expected)
      throw new Error("Workforce runtime privilege drift");
  }
  const [required] = await tx.$queryRaw<{ ready: boolean }[]>`
    SELECT has_schema_privilege(current_user,'public','USAGE') AND has_schema_privilege(current_user,'wf_private','USAGE')
    AND has_function_privilege(current_user,'wf_private.dispatch(text,uuid,jsonb)','EXECUTE')
    AND has_function_privilege(current_user,'wf_private.visible(uuid)','EXECUTE') AS ready`;
  if (!required.ready) throw new Error("Missing workforce runtime privileges");
  // Column ACLs must not sneak business mutations past table-level checks.
  const [columns] = await tx.$queryRaw<{ unsafe: boolean }[]>`
    SELECT EXISTS(SELECT 1 FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid
     WHERE c.relnamespace='public'::regnamespace AND c.relname LIKE 'Workforce%' AND a.attnum>0 AND NOT a.attisdropped
     AND (has_column_privilege(current_user,c.oid,a.attnum,'INSERT') OR has_column_privilege(current_user,c.oid,a.attnum,'UPDATE') OR has_column_privilege(current_user,c.oid,a.attnum,'REFERENCES'))) AS unsafe`;
  if (columns.unsafe) throw new Error("Workforce column privilege drift");
}
export { tenantTransactionOptions };
