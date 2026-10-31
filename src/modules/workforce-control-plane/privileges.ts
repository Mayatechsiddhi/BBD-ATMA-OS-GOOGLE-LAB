export const workforceTables = [
  "WorkforceCompany",
  "WorkforceMember",
  "WorkforceTask",
  "WorkforceReceipt",
  "WorkforceAudit",
] as const;
export const workforceAuthTables = [
  "User",
  "Session",
  "Account",
  "Verification",
  "RateLimit",
] as const;
// Reviewable allowlist, never automatic drift revocation or role elevation.
export function workforceGrants(role: string) {
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(role))
    throw new Error("Invalid workforce role name");
  const quoted = `"${role}"`;
  return [
    `GRANT USAGE ON SCHEMA public,wf_private TO ${quoted};`,
    ...workforceAuthTables.map(
      (t) =>
        `GRANT SELECT,INSERT,UPDATE,DELETE ON TABLE public."${t}" TO ${quoted};`,
    ),
    ...workforceTables.map(
      (t) => `GRANT SELECT ON TABLE public."${t}" TO ${quoted};`,
    ),
    `GRANT EXECUTE ON FUNCTION wf_private.visible(uuid),wf_private.dispatch(text,uuid,jsonb) TO ${quoted};`,
  ].join("\n");
}
