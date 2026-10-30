/** Reviewed allowlist, shared by local provisioning and runtime readiness.
 * Drift is rejected, never repaired by blanket REVOKE or ALTER ROLE.
 */
export const runtimeTables: Record<
  string,
  { privileges: string[]; update?: string[] }
> = {
  OutboxEvent: { privileges: ["SELECT", "INSERT"] },
  OrganizationModule: {
    privileges: ["SELECT", "INSERT"],
    update: ["enabled", "version", "updatedAt"],
  },
  Opportunity: {
    privileges: ["SELECT", "INSERT"],
    update: ["stage", "version", "updatedAt"],
  },
  Patient: { privileges: ["SELECT", "INSERT"] },
  Doctor: {
    privileges: ["SELECT", "INSERT"],
    update: [
      "name",
      "room",
      "revision",
      "updatedAt",
      "schedule",
      "scheduleVersion",
    ],
  },
  QueueToken: {
    privileges: ["SELECT", "INSERT"],
    update: ["status", "callCount", "calledAt", "completedAt", "updatedAt"],
  },
  User: { privileges: ["SELECT", "INSERT", "UPDATE"] },
  Session: { privileges: ["SELECT", "INSERT", "UPDATE", "DELETE"] },
  Account: { privileges: ["SELECT", "INSERT", "UPDATE", "DELETE"] },
  Verification: { privileges: ["SELECT", "INSERT", "UPDATE", "DELETE"] },
  RateLimit: { privileges: ["SELECT", "INSERT", "UPDATE", "DELETE"] },
  Organization: { privileges: ["SELECT"], update: ["name", "updatedAt"] },
  Membership: {
    privileges: ["SELECT", "INSERT", "DELETE"],
    update: ["role"],
  },
  Invitation: {
    privileges: ["SELECT", "INSERT", "DELETE"],
    update: ["acceptedAt"],
  },
  AuditEvent: { privileges: ["SELECT", "INSERT"] },
  Contact: {
    privileges: ["SELECT", "INSERT"],
    update: ["name", "email", "company", "status", "updatedAt"],
  },
  ClinicLead: {
    privileges: ["SELECT", "INSERT"],
    update: ["name", "phone", "email", "source", "status", "updatedAt"],
  },
  Appointment: {
    privileges: ["SELECT", "INSERT"],
    update: ["resource", "startsAt", "endsAt", "status", "updatedAt"],
  },
  FollowUp: {
    privileges: ["SELECT", "INSERT"],
    update: ["title", "dueAt", "status", "completedAt", "updatedAt"],
  },
};
export const runtimeFunctions = [
  "actor_id()",
  "organization_id()",
  "membership_role(text)",
  "invitation_recipient(text,text)",
  "create_organization(text,text,text)",
];

/** Missing allowlisted grants are readiness failures, not privilege drift.
 * Kept separate so local pre-migration bootstrap can remain additive/repeatable.
 */
export function runtimeRequiredPrivilegesSQL(role: "session_user" | "$1") {
  if (role !== "session_user" && role !== "$1")
    throw new Error("Invalid privilege readiness role selector");
  const policy = literal(JSON.stringify(runtimeTables));
  const functions = runtimeFunctions
    .map((name) => literal("bbd_private." + name))
    .join(",");
  return `WITH subject AS (SELECT oid FROM pg_roles WHERE rolname=${role}),
    expected AS (SELECT key AS name,value FROM jsonb_each(${policy}::jsonb)),
    objects AS (SELECT e.*,to_regclass('public.'||quote_ident(name)) AS relation FROM expected e),
    findings AS (
      SELECT 'role' AS kind,'runtime login'::text AS object,'missing role'::text AS privilege WHERE NOT EXISTS(SELECT 1 FROM subject)
      UNION ALL SELECT 'schema',s.name,'USAGE' FROM (VALUES ('public'),('bbd_private')) s(name),subject r
        WHERE NOT coalesce(has_schema_privilege(r.oid,to_regnamespace(s.name),'USAGE'),false)
      UNION ALL SELECT 'table',o.name,'missing relation' FROM objects o WHERE relation IS NULL
      UNION ALL SELECT 'table',o.name,p.privilege FROM objects o,subject r,
        LATERAL jsonb_array_elements_text(o.value->'privileges') p(privilege)
        WHERE o.relation IS NOT NULL AND NOT has_table_privilege(r.oid,o.relation,p.privilege)
      UNION ALL SELECT 'column',o.name||'.'||p.column_name,'UPDATE' FROM objects o CROSS JOIN subject r
        CROSS JOIN LATERAL jsonb_array_elements_text(coalesce(o.value->'update','[]'::jsonb)) p(column_name)
        LEFT JOIN pg_attribute a ON a.attrelid=o.relation AND a.attname=p.column_name AND a.attnum>0 AND NOT a.attisdropped
        WHERE o.relation IS NOT NULL AND (a.attnum IS NULL OR NOT has_column_privilege(r.oid,o.relation,a.attnum,'UPDATE'))
      UNION ALL SELECT 'function',f.signature,'EXECUTE' FROM unnest(ARRAY[${functions}]) f(signature),subject r
        WHERE NOT coalesce(has_function_privilege(r.oid,to_regprocedure(f.signature),'EXECUTE'),false)
    ) SELECT kind,object,privilege FROM findings ORDER BY kind,object,privilege`;
}

/** Reviewed, additive SQL for an operator to inspect; never executes remotely. */
export function runtimeGrantStatements(role: string) {
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(role))
    throw new Error("Use an explicit PostgreSQL runtime role name");
  const target = identifier(role);
  return [
    ...["public", "bbd_private"].map(
      (schema) => `GRANT USAGE ON SCHEMA ${identifier(schema)} TO ${target};`,
    ),
    ...Object.entries(runtimeTables).flatMap(([table, policy]) => [
      `GRANT ${policy.privileges.join(",")} ON TABLE public.${identifier(table)} TO ${target};`,
      ...(policy.update
        ? [
            `GRANT UPDATE (${policy.update.map(identifier).join(",")}) ON TABLE public.${identifier(table)} TO ${target};`,
          ]
        : []),
    ]),
    ...runtimeFunctions.map(
      (signature) =>
        `GRANT EXECUTE ON FUNCTION bbd_private.${signature} TO ${target};`,
    ),
  ];
}
const literal = (value: string) => "'" + value.replaceAll("'", "''") + "'";
export const identifier = (value: string) =>
  '"' + value.replaceAll('"', '""') + '"';

/** Only these two trusted SQL expressions are accepted; role values stay bound. */
export function runtimePrivilegeAuditSQL(role: "session_user" | "$1") {
  if (role !== "session_user" && role !== "$1")
    throw new Error("Invalid privilege audit role selector");
  const policy = literal(JSON.stringify(runtimeTables));
  const functions = runtimeFunctions
    .map((name) => literal("bbd_private." + name))
    .join(",");
  return `WITH subject AS (SELECT * FROM pg_roles WHERE rolname=${role}),
  relations AS (
    SELECT c.*,n.nspname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname !~ '^pg_' AND n.nspname <> 'information_schema'
  ), expected AS (SELECT key AS name,value FROM jsonb_each(${policy}::jsonb)),
  findings AS (
    SELECT 'role' AS kind,r.rolname::text AS object,'elevated attribute or membership' AS privilege
    FROM subject r WHERE r.rolsuper OR r.rolbypassrls OR r.rolcreatedb OR r.rolcreaterole
      OR r.rolreplication OR NOT r.rolcanlogin OR r.rolinherit
      OR EXISTS(SELECT 1 FROM pg_auth_members WHERE member=r.oid)
    UNION ALL SELECT 'ownership',n.nspname,'schema' FROM pg_namespace n,subject r WHERE n.nspowner=r.oid
    UNION ALL SELECT 'ownership',c.nspname||'.'||c.relname,'relation' FROM relations c,subject r WHERE c.relowner=r.oid
    UNION ALL SELECT 'ownership',n.nspname||'.'||p.proname,'function' FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace,subject r WHERE p.proowner=r.oid
    UNION ALL SELECT 'ownership',n.nspname||'.'||t.typname,'type' FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace,subject r WHERE t.typowner=r.oid
    UNION ALL SELECT 'ownership',e.extname,'extension' FROM pg_extension e,subject r WHERE e.extowner=r.oid
    UNION ALL SELECT 'ownership',d.datname,'database' FROM pg_database d,subject r WHERE d.datdba=r.oid
    UNION ALL SELECT 'schema',n.nspname,'CREATE or grant option' FROM pg_namespace n,subject r
      WHERE n.nspname !~ '^pg_' AND n.nspname <> 'information_schema' AND
      (has_schema_privilege(r.oid,n.oid,'CREATE') OR has_schema_privilege(r.oid,n.oid,'USAGE WITH GRANT OPTION'))
    UNION ALL SELECT 'database',current_database(),'CREATE or grant option' FROM subject r
      WHERE has_database_privilege(r.oid,current_database(),'CREATE')
      OR has_database_privilege(r.oid,current_database(),'CONNECT WITH GRANT OPTION')
      OR has_database_privilege(r.oid,current_database(),'TEMP WITH GRANT OPTION')
    UNION ALL SELECT 'table',c.nspname||'.'||c.relname,p.privilege
      FROM relations c CROSS JOIN subject r
      CROSS JOIN (VALUES ('SELECT'),('INSERT'),('UPDATE'),('DELETE'),('TRUNCATE'),('REFERENCES'),('TRIGGER'),('MAINTAIN')) p(privilege)
      LEFT JOIN expected e ON c.nspname='public' AND e.name=c.relname
      WHERE c.relkind IN ('r','p','v','m','f') AND has_table_privilege(r.oid,c.oid,p.privilege)
      AND (NOT coalesce(e.value->'privileges' ? p.privilege,false)
        OR has_table_privilege(r.oid,c.oid,p.privilege||' WITH GRANT OPTION'))
    UNION ALL SELECT 'column',c.nspname||'.'||c.relname||'.'||a.attname,p.privilege
      FROM relations c JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped
      CROSS JOIN subject r CROSS JOIN (VALUES ('SELECT'),('INSERT'),('UPDATE'),('REFERENCES')) p(privilege)
      LEFT JOIN expected e ON c.nspname='public' AND e.name=c.relname
      WHERE c.relkind IN ('r','p','v','m','f') AND has_column_privilege(r.oid,c.oid,a.attnum,p.privilege)
      AND (NOT (coalesce(e.value->'privileges' ? p.privilege,false)
        OR (p.privilege='UPDATE' AND coalesce(e.value->'update' ? a.attname,false)))
        OR has_column_privilege(r.oid,c.oid,a.attnum,p.privilege||' WITH GRANT OPTION'))
    UNION ALL SELECT 'sequence',c.nspname||'.'||c.relname,'access' FROM relations c,subject r
      WHERE c.relkind='S' AND has_sequence_privilege(r.oid,c.oid,'USAGE,SELECT,UPDATE')
    UNION ALL SELECT 'function',n.nspname||'.'||p.oid::regprocedure::text,'EXECUTE or grant option'
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace,subject r
      WHERE n.nspname !~ '^pg_' AND n.nspname <> 'information_schema'
      AND has_function_privilege(r.oid,p.oid,'EXECUTE') AND
      (NOT (n.nspname='bbd_private' AND p.oid IN (SELECT to_regprocedure(signature) FROM unnest(ARRAY[${functions}]) signature WHERE to_regprocedure(signature) IS NOT NULL))
        OR has_function_privilege(r.oid,p.oid,'EXECUTE WITH GRANT OPTION'))
    UNION ALL SELECT 'default',pg_get_userbyid(d.defaclrole),a.privilege_type
      FROM pg_default_acl d CROSS JOIN LATERAL aclexplode(d.defaclacl) a CROSS JOIN subject r
      WHERE a.grantee IN (0,r.oid)
  ) SELECT kind,object,privilege FROM findings ORDER BY kind,object,privilege`;
}
