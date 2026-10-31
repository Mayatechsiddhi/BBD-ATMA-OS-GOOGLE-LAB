# Durable internal workforce control plane — Sprint 3

Base: 41b6b89e214bd34c400cb8c6068cd0b5489b625d. Branch: feat/durable-workforce-control-plane. Local development increment only; no deployment, remote push, external agent or customer-data connection is authorized.

## Architecture and reuse

Founder (final authority) → future Paperclip coordinator → Engineering / Sales / Marketing / Finance / Operations / Support → BBD-approved API & Event Gateway → existing BBD Master ATMA OS.

This increment implements only the durable internal authorization/task boundary before that gateway. Engineering and Operations have deterministic, no-network synthetic draft adapters. The other four departments remain declared architecture, not implemented agents. The controller has no customer route, UI, automatic worker, model, shell, messaging, payment, deployment, merge or customer-outbox integration. No package/dependency version or commercial license changes. Reuses pinned Better Auth, Prisma, PostgreSQL adapter, Zod, Node crypto and existing transaction/pool budgets. Original BBD code only.

The existing in-memory harness remains compatible through its original import paths. Its contract, fixed fixture catalog and deterministic adapter implementation were extracted once into workforce-contract; compatibility re-exports preserve old consumers and tests. No second contract or replacement CRM is built. TypeScript import-boundary tests and ESLint prohibit application/service imports of the internal controller and mock adapter, and prohibit the controller from importing customer database/auth/session/CRM modules. Only the common pool/transaction options are shared from src/lib.

## Identity and database security

- Independent PostgreSQL database, generated Prisma client, runtime role, Better Auth instance, origin, secret and cookie prefix (`bbd-workforce`). There are no customer models/foreign keys. Runtime construction checks enclave tables/roles/grants before any authentication query. No fallback to customer or migration credentials.
- Production runtime refuses customer/test/migration credential environment variables and requires verified PostgreSQL TLS. This is configuration enforcement, not evidence that a real private ingress/TLS/database deployment has been reviewed.
- Signed database-backed Better Auth sessions authenticate requests. The controller reads only the cookie header, ignores user/role headers, accepts no actor ID or role input, and re-reads session expiry/verified identity and current workforce membership under the transaction lock. Session rows are share-locked through the mutation, serializing sign-out/deletion with in-flight actions. Cookie caching is disabled. Signup/account deletion are disabled. No email is sent; fixtures use isolated, owner-provisioned verified synthetic identities and Better Auth password hashing/sign-in. A real enrollment, identity verification/recovery, MFA and Founder binding procedure remains a release gate.
- Workforce roles are REQUESTER, APPROVER, EXECUTOR and FOUNDER, independent of customer OWNER/ADMIN/MEMBER/DISPLAY. Exactly one role per company/user; no role inheritance. Caller-supplied company IDs are untrusted selectors, checked against persisted membership. All allowed tasks require both independent approver consent and separate Founder consent; there is no caller-controlled sensitivity flag. Founder alone pauses/resumes or disables non-Founder members; approvers may revoke their own consent, and Founder can revoke tasks even while paused/expired. Disabling a member blocks its future actions and invalidates its recorded approver/Founder consent; it does not automatically cancel every historically approved submission by that member. Founder can revoke those tasks explicitly.
- Five business tables: WorkforceCompany (pause/version), WorkforceMember (role/active/version), WorkforceTask (immutable request/digest and versioned approval/execution state), WorkforceReceipt (attempt/executor/approval/digest/outcome), WorkforceAudit (append-only through runtime). Better Auth's five identity tables live only in this enclave database.
- Composite task identity and foreign keys scope business relationships by company. The same task UUID can exist in another company without mutation or a global-ID uniqueness oracle. Semantic `(company, correlation, department)` uniqueness prevents resubmission under another UUID. Receipt `(company, task, attempt)` uniqueness prevents duplicate claims.
- Business tables use ENABLE/FORCE RLS with transaction-local actor/session/company settings and a PostgreSQL transaction-ID stamp. Valid scoped context permits only the current company; missing, rolled-back or stale contexts deny. Workflow roles/own-requester visibility are enforced additionally by the command service. Global auth tables are trusted Better Auth storage, not customer data.
- Runtime business grants are SELECT only. No INSERT/UPDATE/DELETE/TRUNCATE, REFERENCES, TRIGGER, ownership, elevated roles, memberships, schema creation or TEMP privileges. Auth CRUD is the reviewed separate Better Auth boundary. Required/excess table/column ACLs, PUBLIC/grant-option ACLs, protected inventory and privileged functions are checked uncached. Provisioning adds reviewed missing grants but rejects dangerous drift; tests restore only their own explicit fixture ACL changes.
- Fixed `wf_private.dispatch` operations implement business transitions; it is not arbitrary SQL, a callback or an arbitrary handler executor. Functions revoke PUBLIC execution and fix search paths including pg_temp last. Closed request/result CHECK functions prevent unknown fields, unsafe artifacts and fabricated payloads even through direct SQL. Only visible/dispatch receive runtime execute grants. Migration-owner policies intentionally allow the privileged owner/definer to provision/access enclave rows; dispatch separately enforces session/company/role/state on every branch. The runtime must never be the owner or inherit its role. Test worker processes are trusted controller replicas, not untrusted agent-code hosts; real agents must never receive this role or its auth signing secret.

RLS is not authentication against a compromised process/SQL credential. Runtime credentials are trusted server credentials: arbitrary SQL could forge transaction context or manipulate global auth. Never give them to Paperclip, models, browsers, customer applications or other agents. Separate private process/storage/secret boundaries and a narrow authenticated gateway are mandatory. The local fixture owner/admin remains privileged and is never a runtime identity.

## Approval, execution and recovery

1. REQUESTER submits the closed v1 synthetic request. The shared validator computes its immutable digest. Identical same-requester replay returns the stored task with no duplicate audit; conflicting ID/input or semantic replay rejects.
2. APPROVER consents to the exact digest/version. Task remains PENDING; this alone cannot dispatch.
3. FOUNDER consents to that same immutable request; a server-generated approval UUID binds the stored approver/Founder identities and membership versions. Approval expires at the earlier of task expiry and five minutes. Lifetime remains at most fifteen minutes.
4. EXECUTOR claims QUEUED → RUNNING using expected version/digest. Claim increments attempt/version and appends one receipt plus audit atomically. Separate processes compete under the same PostgreSQL company advisory lock; only one claim wins. Role, membership versions, approval expiry, pause and request expiry are rechecked under that lock.
5. Outside the claim transaction, only the closed deterministic mock computes an inert result. A finish transaction re-authenticates and rechecks current authorization, digest/version, approval, expiry, pause and receipt ownership. It commits one DRAFT_READY, RETRYABLE_FAILURE or FAILED outcome and audit. Engineering succeeds; Operations deterministically simulates one transient failure before success. Results always identify themselves as mock drafts requiring human review. No injected result or transport is accepted by the service.
6. Retry is an explicit executor transition from RETRYABLE_FAILURE → QUEUED, preserving the attempt count and rechecking all gates. Max attempts remains 1–3. No automatic retries/reclaim, timers or background dispatch exist. Exhaustion is FAILED without a fabricated draft.
7. Revocation sets REVOKED/CANCELLED, removes future stored-result reads and cancels matching receipt state, with audit in the same transaction. Revocation/finish/claim, pause and member disable serialize across processes. A finish committed before revocation may already have returned an inert draft; revocation cannot retract a returned copy. A winning revocation prevents later completion.

Task/receipt/audit mutations roll back together; an injected isolated audit failure proves no partial claim survives. No idle transaction spans mock computation. The common admission/execution budgets remain 2s/5s. Locks serialize all commands per internal company (including reads); this is conservative low-volume control-plane behavior, not a high-throughput queue. Hash collisions may serialize unrelated companies but never grant access.

Durability means committed state survives controller restart and is shared between worker processes. It does not mean external exactly-once side effects. Repeated completion may compute the same pure mock twice but only one result commits. A crash after claim leaves RUNNING/CLAIMED; there is deliberately no automatic lease expiry/re-execution. Founder may revoke and inspect retained evidence. Unknown-outcome reconciliation/fencing, leases, real wall-clock/token/spend budgets and external delivery need a separately reviewed adapter design. `maxRunSeconds` is contract metadata for the fixed bounded mock, not OS preemption.

Durable audit is bounded per read (last 100 records), not automatically pruned. Disk-full/database failure prevents claims and mutations; no unaudited success is returned. Emergency actions need a writable database; durable storage cannot promise an audit write on a failed disk. Future workers require an independent operational kill switch, backup/restore and archival/retention/backpressure controls. No tamper-resistant archive is claimed against the privileged migration owner. Denied commands roll back; durable denial/security telemetry at the future gateway is not implemented. The original mock's bounded denial telemetry remains preserved.

## Migrations, privileges and rollback

Two new additive migrations under prisma/workforce/migrations, applied only to isolated new workforce test databases. The twelve original customer migrations and fourteen-table customer RLS inventory are unchanged. No customer grants or data backfill. The enclave has ten application tables, four private functions (two definer command/visibility functions and two invoker contract checks), and explicit reviewed runtime grants in privileges.ts. A separate Prisma config targets WORKFORCE_MIGRATION_DATABASE_URL; never inject that credential into runtime workers.

Local commands (existing pinned dependencies only):

- `npm run db:workforce:generate`
- `npm run db:workforce:test:prepare` — local dedicated database/roles only; applies twice, authenticates restricted owner, verifies checksums/ownership and provisions reviewed fixture grants. Credentials stay in private /tmp/bbd-workforce-control. Refuses unexpected ownership/elevation/drift; never resets/drops a database.
- `npm run test:workforce`
- `npm run test:workforce:pooler` — reuses the existing pinned PgBouncer runner in transaction mode; owner fixture administration stays direct.

Future reviewed deployment procedure: independently provision a private enclave database and non-superuser migration owner; review both SQL migrations; in an offline migration process run pinned Prisma migrate deploy with prisma/workforce.config.ts and WORKFORCE_MIGRATION_DATABASE_URL; review/execute only the allowlisted grants for a separate non-owner/non-bypass role; preflight required/excess ACLs and owner/role/session behavior; provision approved identities/Founder binding through an audited operator procedure; review REVOKE CONNECT,TEMPORARY ON DATABASE <workforce_database> FROM PUBLIC and GRANT CONNECT ON DATABASE <workforce_database> TO <workforce_runtime> before applying database boundary permissions; configure the database/session timezone as UTC (the tested instance reports Etc/UTC); configure only enclave credentials in a separate private process. No migration runs during application startup, and no such deployment was performed.

Rollback is stop new ingress/claims, Founder pause/revoke where the database is healthy, preserve database/receipt/audit evidence and backups, then roll back the controller artifact. Leave additive enclave tables and migrations in place. Never drop/reset shared data, clear receipts or blindly revoke existing roles. Restore to an isolated database and reconcile unknown claims before resuming. The customer application needs no rollback because no customer schema/service behavior changed. Exact before/after restore and deployed TLS/ingress need independent qualification.

## Validation and retained failures

Final local validation — 31 October 2026 (private runner timestamps UTC):

| Check                                                | Result                                     | Evidence boundary                                                                                                                                                                                                                                                                                  |
| ---------------------------------------------------- | ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit                                                 | PASS: 198 tests, 20 files                  | Existing harness preserved; added controller/adapter import boundaries and production credential/TLS guards                                                                                                                                                                                        |
| Customer PostgreSQL integration                      | PASS: 110 tests, 11 files                  | Existing CRM/Clinic/entitlements/events and twenty preserved in-memory harness cases                                                                                                                                                                                                               |
| Workforce PostgreSQL integration                     | PASS: 22 tests                             | Signed authentication, forged identity, company isolation including equal UUIDs, role/Founder gates, independent pools and OS worker processes, restart replay, stale versions/consents, expiry/retry, pause/revoke races, audit rollback, valid/unscoped RLS, grant drift and identity revocation |
| Customer runtime privileges                          | PASS: 30 tests                             | Original restricted-role regression suite                                                                                                                                                                                                                                                          |
| Workforce runtime privileges                         | PASS within 22-case workforce suite        | Direct mutations/TRUNCATE denied; excess table and column grant-option ACL and missing SELECT fail readiness; migration-owner credentials denied                                                                                                                                                   |
| Customer migration-owner                             | PASS: 110 overlapping tests                | Existing independently authenticated restricted migration login; twelve original migrations and fourteen protected tables unchanged                                                                                                                                                                |
| Workforce migration-owner                            | PASS                                       | Both new migrations applied/reapplied under an independent non-superuser/non-bypass login; file checksums, ten table owners, two definer owners and runtime readiness checked                                                                                                                      |
| Customer PgBouncer                                   | PASS: 110 overlapping tests                | Existing actual transaction-mode pooler suite                                                                                                                                                                                                                                                      |
| Workforce PgBouncer                                  | PASS: 22 overlapping tests                 | Separate workforce DB/role, transaction mode, one backend, SCRAM and prepared-statement tracking; includes real child-process claim contention and valid RLS context tests                                                                                                                         |
| HTTP / Server Actions                                | PASS: 68 dispatched requests               | Zero failed diagnostic stages; no warmed rerun needed this sprint; existing deadlines unchanged                                                                                                                                                                                                    |
| Browser                                              | PASS: 18 groups                            | Invitation/auth, CRM/Clinic/scheduling/slots, events/entitlements, calling/SSE/privacy/revoked-display clearing; source and secret-log guards passed; exit 0 at 2026-10-31T12:54:11.162Z                                                                                                           |
| Auth-proxy                                           | PASS: 2 groups                             | Existing production-mode ingress/rate-limit simulation, not real private workforce ingress                                                                                                                                                                                                         |
| Build, lint, type-check, formatting, diff whitespace | PASS                                       | Both generated clients used; no app runtime workforce configuration required                                                                                                                                                                                                                       |
| License inventory                                    | PASS / unchanged                           | No new dependencies or license records; no live advisory lookup performed                                                                                                                                                                                                                          |
| Workflow YAML                                        | PASS: existing js-yaml parser and Prettier | actionlint unavailable; not installed                                                                                                                                                                                                                                                              |
| Secret checks                                        | Zero known credential-value matches        | Local/staged check against private app/workforce fixture values plus narrow high-confidence patterns; not a full Gitleaks/history scan                                                                                                                                                             |

Counts overlap: pooler/migration reruns are not additional unique tests; twenty of the customer integration cases are pure in-memory harness tests and do not exercise pooling. Workforce integration/pooler cases do exercise the separate real PostgreSQL runtime. Browser/HTTP cover the existing application because there is deliberately no workforce HTTP route or UI. There was no need to change browser/HTTP assertions or timeouts.

Not run: hosted CI (no push authorized), fresh legacy migration-owner provisioning this sprint (existing restricted owner revalidated; workforce owner was freshly provisioned), production browser/ingress/TLS/provider pooler, real Founder enrollment/MFA/recovery, disk-full/backup restore and external agents/delivery. Private logs and exit records remain under /tmp/bbd-workforce-durable. The owned Next server and local test containers are stopped after validation; database volumes and experimental fixture databases are preserved.

Retained development failures: the initial schema diff ran before local PostgreSQL was started and failed to connect (no database mutation). A cross-company same-UUID regression exposed the prototype's global primary key; corrected the uncommitted new workforce migration and moved final validation to a fresh isolated fixture database, preserving the older experimental database. An early type-check caught a fixture Object.entries key typing error, corrected without casts to any. First workforce pooler run failed readiness before any cases executed: an empty column-ACL array was passed to aclexplode, which PostgreSQL rejects; the scanner now handles null/empty column ACLs safely, and the rerun passes. None of these failures is relabeled a pass. The prior Sprint 2 initial HTTP cold-start timeout remains recorded in WORKFORCE_HARDENING.md; no deadlines or security assertions have changed.

## Remaining gates

W2/W3 now have a real signed-session and durable database implementation, not a constructor-only authorization ledger. This does not close production release gates: verified human Founder enrollment, MFA/recovery, machine identity design, private authenticated ingress, CSRF/origin checks for future mutation endpoints, safe error responses and trusted IP handling, security review of definer functions/grants/RLS, real provider pooling/TLS, crash/restore/disk-full fault drills, durable denial telemetry, audit retention and adapter fencing remain. No real agents, external delivery, production browser environment or production database were tested. Independent human security review is mandatory.

Next integration gate: review this local increment, then separately approve a private Founder/internal operator interface and the authenticated BBD gateway contract for metadata-only draft requests/results. Paperclip remains a future coordinator and receives no database/migration credentials, customer data access or direct business-side-effect authority. Reverify its exact source/license and adapter sandbox before any installation. No live model, payments, messaging, autonomous merge or deployment is authorized by this increment.

## Changed-file manifest

36 modified/new files relative to the clean base; the customer Prisma schema, all twelve original migrations, dependency lockfile and customer application/domain source are unchanged.

- `docs/DURABLE_WORKFORCE_CONTROL_PLANE.md`
- `prisma/workforce.config.ts`
- `prisma/workforce/migrations/202610310001_workforce_control_plane/migration.sql`
- `prisma/workforce/migrations/202610310002_closed_contracts/migration.sql`
- `prisma/workforce/migrations/migration_lock.toml`
- `prisma/workforce/schema.prisma`
- `scripts/workforce/claim-fixture.ts`
- `scripts/workforce/grants-plan.ts`
- `scripts/workforce/prepare-test.mjs`
- `scripts/workforce/test.mjs`
- `src/modules/workforce-contract/contract.ts`
- `src/modules/workforce-contract/fixtures.ts`
- `src/modules/workforce-contract/mock-adapter.ts`
- `src/modules/workforce-control-plane/control.ts`
- `src/modules/workforce-control-plane/database.ts`
- `src/modules/workforce-control-plane/identity.ts`
- `src/modules/workforce-control-plane/privileges.ts`
- `tests/unit/workforce-environment.test.ts`
- `tests/workforce/control-plane.test.ts`
- `vitest.workforce.config.ts`
- `.env.example`
- `.github/workflows/ci.yml`
- `AGENTS.md`
- `ARCHITECTURE.md`
- `README.md`
- `ROADMAP.md`
- `docs/WORKFORCE_HARDENING.md`
- `eslint.config.mjs`
- `package.json`
- `scripts/prisma-wasm.mjs`
- `scripts/test-pooler.mjs`
- `scripts/workforce-import-boundary.ts`
- `src/modules/internal-workforce/contract.ts`
- `src/modules/internal-workforce/fixtures.ts`
- `src/modules/internal-workforce/mock-adapter.ts`
- `tests/unit/workforce-boundary.test.ts`
