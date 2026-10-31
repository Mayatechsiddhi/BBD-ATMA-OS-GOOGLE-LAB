# Workforce security corrections — uncommitted development validation

Base/HEAD: 69cd00a7b9c0a4e3b6f424ee2b3ac9bf43eeda1f on feat/durable-workforce-control-plane. HEAD is intentionally unchanged. No branch switch, staging, commit, push, deployment, new engine, DeepSeek Harness/ECC installation or real-agent execution. The uncommitted WORKFORCE_CONTROL_PLANE_SECURITY_REVIEW.md is historical evidence and remains byte-for-byte unchanged (SHA-256 8ebeb546e8e83d9d1a597e69745fd43bac8033917998e6c722920c1e77bff63d).

## Scoped corrections

- M1: one common SQL eligibility block now checks current executor authority, pause/expiry, approval state/expiry and both consenting members' active role/version before execution-input, claim, finish or retry. Four regressions change approver/Founder active/version after claim and prove the mock adapter is not invoked. Finish still rechecks after computation; no claim that a future external effect is atomically revocable is made.
- M2: WorkforceAudit adds nullable subjectUserId, a composite company/member foreign key and an enforced-for-new-rows member.disabled subject check. The target, actor and resulting version commit with disablement. Tests distinguish two subjects at equal versions, reject a foreign/missing subject, and force audit failure to prove member/version rollback.
- L1: the existing AST boundary guard now closes allowed shared contract and pool-option dependencies as well as direct controller imports. Every source edge is still inspected; a shared barrel cannot bridge into customer modules. Tests cover alias, re-export, require, import-type and dynamic-import edges and preserve valid pure dependencies. This remains static policy, not a JavaScript/package sandbox.
- L2: both authoritative SQL session comparisons interpret Better Auth's timezone-less expiry explicitly as UTC. A non-UTC connection test proves live context works, expired context is invisible and dispatch denies; SET LOCAL is scoped to the test transaction. Better Auth's separate signed-session validation remains unchanged.
- L3: failed workforce identity setup now disconnects the already-allocated/checked client, preserving original configuration errors. Lifecycle tests cover readiness failure, missing signing secret and invalid origin without opening a real unit-test database connection.
- Coordinated cutover: runtime preflight also requires the audit subject column and correction constraints. Old/incomplete schemas fail closed before authentication queries. Two unit cases cover false/missing correction metadata. Runtime grants are unchanged; no migration-table SELECT permission or generic SQL interface is added.

## Persistence and migration impact

One new additive migration: prisma/workforce/migrations/202610310003_workforce_security_corrections/migration.sql. It adds one nullable audit column and constraints and replaces the existing visibility/dispatch functions atomically inside BEGIN/COMMIT. No new table, role, grant or authoritative store. The two existing workforce migrations and twelve customer migrations remain unchanged. It was applied to the existing guarded local workforce test database and then reapplied as a no-op. Customer schemas/business source remain unchanged.

Historical member.disabled events without a subject cannot be accurately reconstructed. They remain untouched. The subject CHECK is NOT VALID for historical rows but enforced on new/updated rows; the foreign key retains company-scoped subject integrity. Do not backfill guessed identities or claim the historical audit is now complete.

Reviewed rollout requirement (not performed): apply the additive migration with the separate migration owner before starting the corrected controller; runtime readiness rejects the older schema. Pause/drain workers and review ALTER TABLE locking for the actual workload. Keep the database correction when rolling back an application artifact; do not drop subjects, erase receipts or restore weaker authorization functions. Existing owner/ACLs are preserved by CREATE OR REPLACE. Production migration, backup/restore and deployment remain unauthorized.

## Before/after regression evidence

- New guard/lifecycle tests before corrections: 8 FAIL, 16 PASS (24 cases). Six transitive dependency cases escaped the guard; two identity initialization paths omitted disconnect.
- New PostgreSQL admission/timezone cases before migration: 5 FAIL; 25 cases deliberately not selected for that baseline probe. Four stale-consent cases still invoked the mock before finish denied; the expired UTC session appeared valid to the old implicit-timezone predicate.
- Final full runs include every test, with no security skips, assertion reductions or increased timeouts. The original 2s transaction acquisition / 5s transaction execution and existing HTTP/browser deadlines remain.
- First full type-check caught a test-only inferred UUID-array element type conflicting with the database's opaque string subject IDs. Corrected the array annotation; the subsequent type-check passed. The initial failure remains in private logs.

Final local verification completed 31 October 2026 (evidence timestamps UTC):

| Check                          | Result                                           | Scope                                                                                                                                                                 |
| ------------------------------ | ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit                           | PASS: 210 tests, 22 files                        | Before: 198; twelve targeted cases added                                                                                                                              |
| Existing app integration       | PASS: 110 tests, 11 files                        | 90 PostgreSQL plus 20 preserved in-memory harness cases                                                                                                               |
| Workforce integration          | PASS: 30 tests                                   | Before: 22; eight new real PostgreSQL regression cases                                                                                                                |
| Existing runtime privileges    | PASS: 30 tests                                   | Original isolated privilege fixtures                                                                                                                                  |
| Migration-owner                | PASS: 110 overlapping existing-app cases         | Existing restricted migration login, original migrations preserved                                                                                                    |
| Workforce migration/readiness  | PASS                                             | New migration applied once to existing fixture, repeat no-op; old checksums/owners/grants preserved and new readiness marker checked                                  |
| Existing PgBouncer             | PASS: 110 overlapping cases                      | Actual transaction-mode pooler                                                                                                                                        |
| Workforce PgBouncer            | PASS: 30 overlapping cases                       | Includes new consent, subject/FK/rollback and non-UTC session tests                                                                                                   |
| Auth-proxy                     | PASS: 2 groups                                   | Existing production-mode simulation, not actual ingress                                                                                                               |
| HTTP                           | PASS: 68 requests, zero failed diagnostic stages | Exit 0 at 2026-10-31T15:24:59.745Z; no retry or deadline changes                                                                                                      |
| Browser                        | PASS: 18 groups                                  | Exit 0 at 2026-10-31T15:30:26.318Z; complete invitations/CRM/Clinic/schedules/slots/events/entitlements/calling/SSE/privacy regressions and log/source guards         |
| Build, lint, type-check        | PASS                                             | Type-check initial fixture annotation error preserved above; unchanged source behavior after annotation correction                                                    |
| Formatting and diff whitespace | PASS                                             | Initial full formatting check flagged the new readiness unit file; scoped formatting corrected it and full rerun passed. Report formatting checked after finalization |

Suite counts overlap and are not totals of unique security coverage. No completed HTTP/browser suite was restarted after the continuation request: the already-passing HTTP result was reused, and the in-flight browser process was allowed to finish with source frozen. No test assertion, security rule or timeout was weakened.

NOT RUN / UNVERIFIED: hosted CI (no push), actionlint (unavailable; no workflow change), fresh-database migration provisioning in this sprint (existing databases preserved), real ingress/TLS/MFA, model/agent execution, production migrations, recovery/restore and storage-failure drills. These are not passing checks. No new database engine or workforce store was installed. Existing regression runners used their normal guarded synthetic fixtures only.

Completed verification is preserved; no tests remain pending locally. Raw synthetic evidence and exit records are private under /tmp/bbd-workforce-corrections and are not committed. No fresh dependency/advisory/network scan or scanner installation is implied.

## Remaining limits

Founder enrollment/MFA, private authenticated ingress/CSRF, machine identities, external-effect fencing, unknown-claim/crash reconciliation, storage failure/out-of-band kill controls and backup/restore qualification remain release gates. No live adapter, customer-facing workforce route or new operator UI is enabled. Independent human security review remains mandatory. A passing mock suite does not authorize real-agent execution or production use.

## Correction file manifest

10 correction/report files, all uncommitted and unstaged. The pre-existing uncommitted security review is separate and unchanged.

- `docs/WORKFORCE_SECURITY_CORRECTIONS.md`
- `prisma/workforce/migrations/202610310003_workforce_security_corrections/migration.sql`
- `tests/unit/workforce-correction-readiness.test.ts`
- `tests/unit/workforce-initialization.test.ts`
- `prisma/workforce/schema.prisma`
- `scripts/workforce-import-boundary.ts`
- `src/modules/workforce-control-plane/control.ts`
- `src/modules/workforce-control-plane/database.ts`
- `tests/unit/workforce-boundary.test.ts`
- `tests/workforce/control-plane.test.ts`
