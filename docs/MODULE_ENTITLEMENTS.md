# Phase 1 — tenant module control plane

Branch: `feat/tenant-module-entitlements`, based exactly on `f2618c5ca81e6a31cb278043dbc5a49da95d4c5d`. Original BBD code; no dependency, package-lock, service, engine or licensing change.

## Implemented scope

- `src/modules/registry.ts` is the reviewed deployment catalog. CRM and Clinic are available; ATMA, agents, workflows, marketing and industry packages remain planned. Availability is independent of an organization entitlement. Unknown, unavailable, disabled and missing entitlements deny access.
- `OrganizationModule` has a composite organization/module primary key, tenant foreign key, false default, nonnegative version, known-module/availability CHECK constraints and FORCE RLS. Runtime SELECT/INSERT plus UPDATE of enabled/version/updatedAt only; no DELETE, tenant-key updates, ownership or bypass grants. DISPLAY can read access flags to support private calling but gains no business-data permissions.
- Only OWNER can manage entitlements. ADMIN and MEMBER can inspect the module catalog; DISPLAY cannot open the administration page. This is manual tenant feature administration, **not a paid-plan grant or billing authority**. Future paid entitlements need separately approved control-plane authority; do not reinterpret these owner toggles as subscription enforcement.
- Existing organization locks serialize access-changing writes against reads and mutations. Page entitlement checks reuse the existing organization transaction rather than performing a separate preflight transaction. Fresh membership and flags are checked within the same transaction as the operation. Disable waits for in-flight authorized operations; after commit, subsequent operations fail closed. Stale versions fail; identical current-version no-ops do not create audits. Entitlement change and audit append roll back together.
- All existing CRM/contact/opportunity and Clinic/appointment/follow-up/schedule/patient/doctor/queue services use a fixed module binding. No module ID supplied by a browser chooses the policy. Existing Server Actions independently obtain the actor from requireSession; the submitted/bound organization ID is only an untrusted resource selector authorized against current membership. No actor/tenant field is accepted in entitlement input.
- The existing modules page shows actual access and owner forms. Disabled pages return 404; captured business actions are denied server-side. Existing navigation links may still point to disabled routes; link visibility grants no access. Organization settings/members/modules remain reachable when business modules are disabled.
- Calling SSE checks Clinic entitlement through board() on every snapshot. Disabling does not retract data already delivered; the next polling check closes the stream and existing stale/unavailable display handling clears calls. Production proxy/device behavior remains a release gate.
- Disabled modules retain all existing business data. No billing, public API, external engine, workflow runner or AI call is added.

## Migration and deployment impact

`202610310001_module_entitlements` is one additive, transactional migration. The ten original migrations are unchanged. It creates one table, constraints, indexes and RLS policies. It backfills CRM/Clinic enabled at version zero for existing organizations; it changes no existing business rows or policies. New organization creation seeds these two explicit grants and an initialization audit inside the bootstrap transaction. No other catalog entries are automatically granted. Activating a future module requires reviewed registry code and a corresponding constraint migration, followed by an explicit organization grant. Backfill has migration-history evidence rather than a fabricated user audit actor.

The runtime allowlist, FORCE-RLS guard and non-superuser migration-owner inventory now include thirteen protected tables. Review generated `npm run db:grants:plan` SQL and apply only the additive table/column grants to the intended restricted runtime role, after the migration. Existing role attributes, defaults and excess ACLs must continue to fail closed; no automatic revoke/repair is introduced. Missing required grants fail startup/readiness.

**Additive schema does not imply mixed-version operational compatibility.** Old binaries reject the new runtime grants under their strict allowlist and do not enforce entitlement flags. Coordinate the migration/grants/new-artifact cutover with old instances drained before relying on revocation. Pause organization creation or drain old writers before backfill: old binaries creating organizations after backfill do not initialize flags, so those organizations would correctly fail closed until a reviewed initialization. New binaries require the new schema/grants. Keep the additive table and data on rollback; use a reviewed compatible artifact/grant plan, not blind revocation or migration deletion. An older application also must not serve while a disabled module is expected to remain blocked. Migration backfill scans organizations and inserts two rows each; assess tenant count/lock budget before any approved deployment.

RLS protects tenant boundaries and owner-only entitlement writes, but business-table RLS policies are unchanged: entitlement checks are the trusted service layer's responsibility. Arbitrary SQL with forged server context/full application compromise remains outside the existing threat model. Future module entry points must adopt moduleAccess; no automatic inference from URL names or table names is claimed. Independent human review of this boundary, migration, grants and rollback is required before release.

## Validation

Validation date: 31 October 2026 IST. Node 24.19.0; Chromium 154.0.8037.57. Only local synthetic fixtures and dedicated test databases were used. The ordinary local `bbd` application database was not migrated. Production build ran locally without deployment.

| Check                                                                        | Actual result                                                                                                                                                                                        |
| ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Prisma client generation                                                     | PASS, existing pinned official WASM runner                                                                                                                                                           |
| Type-check, ESLint, formatting, diff whitespace                              | PASS                                                                                                                                                                                                 |
| Unit suite                                                                   | PASS: 149 tests, 15 files                                                                                                                                                                            |
| Direct PostgreSQL integration                                                | PASS: 83 tests, 9 files after final transaction refactor                                                                                                                                             |
| Isolated runtime privileges                                                  | PASS: 28 tests; includes pre-migration data/backfill and old-artifact grant rejection                                                                                                                |
| Reused non-superuser migration owner                                         | PASS: 83 tests on final source; 11 migration checksums and 13 owned/RLS-protected tables verified                                                                                                    |
| Fresh non-superuser migration owner                                          | PASS: 83 tests on final source; all 11 migrations applied twice without reset                                                                                                                        |
| PgBouncer 1.26.1 transaction mode, one server connection                     | PASS: 83 tests on final source through actual transaction pooling; fixture administration remained direct                                                                                            |
| Production build                                                             | PASS after final transaction refactor                                                                                                                                                                |
| Production-mode auth HTTP simulation                                         | PASS: 2 groups against final production artifact; loopback gateway simulation only                                                                                                                   |
| Actual Next HTTP/Server Actions                                              | PASS, exit 0 after final refactor; existing workflows plus entitlement toggles, disabled page/captured POST denial, stale forms, foreign-session denial and audits                                   |
| Complete browser suite                                                       | PASS: 17 PASS groups, exit 0; includes auth/invitations, clinic, slots, schedules, opportunities, new entitlement UI/replay/disabled-SSE checks, calling, source stability and server-log exclusions |
| Staged-diff secret scan                                                      | PASS: Gitleaks 8.30.1, redacted staged-diff scan, zero findings; not a full-history/environment scan                                                                                                 |
| Hosted CI, production-browser, real ingress/provider pooler, cutover/restore | NOT RUN; not authorized or not part of this local validation                                                                                                                                         |

The 83-test migration/pooler runs repeat the integration suite under different connections; they are not additional unique tests. Entitlement-specific additions are four unit cases (plus five role-matrix cases), nine PostgreSQL integration cases, two isolated privilege/migration cases, two HTTP evidence groups and one browser evidence group. Integration cases cover missing/planned flags, owner-only administration, cross-tenant and dual-member contexts, disabled reads/writes/calling, data preservation, re-enable without role escalation, immutable keys/delete denial, optimistic concurrency, exclusive revocation and rollback on a deliberately failed audit append.

### Failures retained rather than hidden

1. Initial parallel verification ran the build alongside migration/pooler suites. One migration-role transaction expired (5-second budget, 23,137ms observed), and the pooler foundation setup hit the 60-second hook deadline: 64 tests passed, 19 were skipped in that failed pooler run. Sequential reruns passed without changing any deadline. Concurrent verification workload is a relevant observation, not proof that production capacity is adequate.
2. First traced browser run failed at `browser-invitations.ts` signup POST before feature scenarios: 15-second client timeout. A nearby server signup entry recorded HTTP 200 in 4.0 seconds; the trace did not retain the API request exchange, so exact request/delay attribution is limited. Exact client/transport delay causation is not established.
3. Second traced run passed invitations, clinic and slots but failed waiting for the expected schedule leave-conflict message at `browser-schedules.ts:110`; server logs contained two expired transactions (6,801ms and 6,919ms against the unchanged 5-second budget). No authorization bypass or partial committed entitlement change was observed. The first page gate unnecessarily added its own privilege-audited transaction; it was removed by checking flags within the existing organization transaction. That source-level reduction does not prove the entire timeout was caused by the extra transaction.
4. Final full browser run used the normal CI setting (optional trace capture off), serial validation and warmed routes, including schedules/opportunities. All assertions, the source-stability guard, log checks and original deadlines remained enabled. It passed 17 groups, with no reported rendering/decoder errors. This is not proof of reliable cold navigation, tracing under load or production browser behavior. The earlier failures remain FAIL records.

Sanitized final outputs and exit records are retained under `/tmp/bbd-module-checks/`. Failing raw traces remain private under `/tmp/bbd-browser-module-entitlements/` and `/tmp/bbd-browser-module-entitlements-rerun/`; these may contain synthetic session credentials and must not be committed or uploaded. No existing evidence was deleted.

### Remaining review and release gates

- Independent human security review of fixed module bindings, owner authority, RLS, atomic audit, migration and runtime grants remains required. This is not production-readiness certification.
- Rehearse coordinated artifact/grant/organization-bootstrap cutover and compatible rollback; do not serve old code while relying on module revocation. Review backfill size and migration lock budget for the actual organization count.
- Existing browser/transaction contention under diagnostic or cold load remains a capacity/reliability risk; do not raise timeouts or cache authorization to conceal it. The local runs do not establish multi-instance load limits.
- Business-table RLS remains a tenant defense; it is not an entitlement boundary against arbitrary trusted-context SQL. Future tenant module entry points must adopt the same service gate. Planned modules require separately reviewed code and migrations before activation.
- Existing real-ingress/TLS, provider pooler, backup/restore, privacy/retention, production-browser and operational approval gates remain. No billing, provider API, external engine, push, merge or deployment was activated.

## Changed-file manifest

41 changed/new source, test, migration and documentation files; generated Prisma/Next output and private diagnostics are excluded. Existing business migrations and the dependency lockfile are unchanged.

- `AGENTS.md`
- `ARCHITECTURE.md`
- `ROADMAP.md`
- `docs/MODULE_ENTITLEMENTS.md`
- `prisma/migrations/202610310001_module_entitlements/migration.sql`
- `prisma/schema.prisma`
- `scripts/browser-entitlements.ts`
- `scripts/browser-invitations.ts`
- `scripts/http-smoke.ts`
- `scripts/verify-rls-migrations.mjs`
- `src/app/module-actions.ts`
- `src/app/organizations/[organizationId]/clinic/appointments/page.tsx`
- `src/app/organizations/[organizationId]/clinic/follow-ups/page.tsx`
- `src/app/organizations/[organizationId]/clinic/leads/[leadId]/page.tsx`
- `src/app/organizations/[organizationId]/clinic/leads/page.tsx`
- `src/app/organizations/[organizationId]/clinic/page.tsx`
- `src/app/organizations/[organizationId]/clinic/reception/page.tsx`
- `src/app/organizations/[organizationId]/clinic/schedules/page.tsx`
- `src/app/organizations/[organizationId]/crm/opportunities/page.tsx`
- `src/app/organizations/[organizationId]/crm/page.tsx`
- `src/app/organizations/[organizationId]/modules/page.tsx`
- `src/lib/runtime-privileges.ts`
- `src/lib/tenant-context.ts`
- `src/modules/calling/service.ts`
- `src/modules/clinic/schedule-service.ts`
- `src/modules/clinic/service.ts`
- `src/modules/crm/opportunities.ts`
- `src/modules/crm/service.ts`
- `src/modules/entitlements/access.ts`
- `src/modules/entitlements/service.ts`
- `src/modules/entitlements/validation.ts`
- `src/modules/organizations/page-context.ts`
- `src/modules/organizations/policy.ts`
- `src/modules/organizations/service.ts`
- `src/modules/registry.ts`
- `tests/integration/entitlements.test.ts`
- `tests/integration/tenant-isolation.test.ts`
- `tests/privileges/runtime-privileges.test.ts`
- `tests/unit/database-readiness.test.ts`
- `tests/unit/entitlements.test.ts`
- `tests/unit/policy.test.ts`
