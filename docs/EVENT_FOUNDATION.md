# Phase 2A — tenant-safe event foundation

Base: `feat/tenant-module-entitlements` at `dd99e7eeddeb2a201bbc4dbf0e89789da12fcb22`. Implementation branch: `feat/tenant-event-foundation`. Original BBD code, existing pinned dependencies only. The entitlement branch and PR #9 are not modified or merged.

## Implemented contract

Only `crm.opportunity.created`, schema version 1, is supported. An immutable OutboxEvent contains a random UUID event ID, organization ID, positive per-organization BIGINT sequence, event type, schema version, PostgreSQL `clock_timestamp()` capture timestamp, tenant-scoped parent opportunity ID and JSON payload **exactly** `{ "opportunityId": "<opaque-id>" }`. No names, phones, email addresses, deal titles/amounts, patient data, credentials, arbitrary commands or provider configuration are copied. SQL CHECK constraints enforce the supported type/version and exact payload shape (at most 1,024 bytes); strict Zod schemas validate writes and returned envelopes.

The existing `createOpportunity` mutation is the only producer. Opportunity, event and audit commit in the **same** Prisma transaction under the existing exclusive organization lock and current CRM entitlement/role checks. Event or audit failure rolls everything back. Existing replay/changed-request behavior is preserved: the tenant/requestKey identifies the business mutation; returning an existing opportunity emits nothing. The outbox additionally has global event UUID uniqueness and a tenant/type/opportunity/schema semantic unique key. Duplicate raw appends fail rather than silently discarding a sequence collision. Old opportunities are not backfilled and replay does not fabricate historical events. Stage changes do not emit this creation event.

## Internal processing interface and authorization

`readEventBatch(actor, organizationId, { after: "0", limit: 25 })` is a bounded **pull interface for future internal consumers**, not a running dispatcher or completed-delivery claim. Limit is 1–50; cursors are validated decimal BIGINT strings without Number precision loss. Each envelope is validated before returning a cursor; unknown types/versions or corrupt payloads fail the entire batch rather than being skipped. Empty batches keep the input cursor. The DTO includes only validated envelope fields; it supplies no database connection, transaction callback, SQL, credentials or arbitrary handler.

Actor identity is trusted server context, never a browser parameter. Reads recheck current membership and CRM entitlement under a shared organization transaction lock. `events:read` is OWNER/ADMIN only. MEMBER and DISPLAY cannot read outbox rows even through raw runtime SQL with their legitimate context. No Server Action, public/private HTTP endpoint, UI event directory, background loop, worker identity or provider callback is added. The browser exercises the existing CRM action; event inspection is fixture-only, not exposed to the page.

Runtime privileges are SELECT/INSERT only. No UPDATE, DELETE, TRUNCATE, identity mutation or table ownership is granted. FORCE RLS requires matching transaction-bound organization context and OWNER/ADMIN membership. Composite organization/opportunity FK prevents foreign-tenant parent attachment. The append helper accepts only an existing trusted transaction and concrete opportunity reference, and **must** be called inside the authorized exclusive producer boundary; it is not a generic event publisher. Business-table RLS/entitlement threat boundaries remain unchanged: arbitrary SQL with forged trusted server context or migration-owner compromise is outside this defense.

## Ordering and idempotency assumptions

- Sequence allocation uses tenant-scoped MAX(sequence)+1 while holding the existing exclusive organization advisory lock until commit. Compliant producers cannot publish a lower sequence after a reader has observed a higher one. A reader takes the matching shared lock. Rollback never exposes an event; the rolled-back sequence can be reused safely because no reader saw it.
- Order is per organization for producers obeying this boundary, not global or wall-clock order. Transaction start time, capture timestamps, UUID ordering and business timestamps are **not** cursors. Sequence values are serialized as strings; consumers must bind progress to both organization and consumer identity.
- Direct runtime/migration SQL that ignores the producer lock can violate ordering assumptions. Database constraints reject duplicate sequence/semantic identities but do not authenticate a trusted server actor or prove the correct organization lock is held. No such arbitrary SQL interface is exposed.
- A future adapter must treat delivery as at least once: use `(organizationId, consumerId, eventId)` for durable deduplication and a provider idempotency key where supported. Atomically record local effects and its receipt when they share a database. For remote effects, reconcile crash windows with provider idempotency/status lookup; do not claim exactly once.
- `nextAfter` is a replay cursor, **not** a durable acknowledgment or signed authorization token. Re-reading the same cursor repeats the same records. This phase deliberately does not mark events delivered or store consumer progress. Durable per-consumer checkpoint/receipt storage, leases, retries/backoff, dead letters and recovery are separately approved work before any external delivery. Never advance a checkpoint before processing or durable hand-off is safe.
- Authorization at read time is not permission for a later external action. Future adapters must reauthorize tenant/module/tool/consent at execution, especially after entitlement/member revocation, and must not put user sessions or database credentials into third-party workflows.

## Migration, performance and rollback

`202610310002_event_outbox` adds one table, scoped FK/uniqueness, CHECK constraints and FORCE RLS policies. All eleven previous migrations are unchanged. No existing opportunities/business rows are rewritten and no historical event backfill is performed. The guarded inventory becomes fourteen tenant tables; strict readiness requires reviewed OutboxEvent SELECT/INSERT grants. No sequence object, new SQL function or runtime schema/DDL privilege is introduced.

Apply only to an approved target after independent review: coordinate migration, generated additive grant plan and compatible artifact. Old artifacts reject new grants under the strict allowlist; new artifacts require the new schema. Drain old producers before expecting all new mutations to emit events. Keep the additive outbox and history on rollback; do not delete a migration or blindly revoke grants. A rollback artifact must understand the current grant contract, or an operator must separately review a coordinated role/grant plan. No production migration, grant change, deployment or push is performed here.

One additional indexed maximum query and event insert run in each successful new-opportunity transaction; replay does not append. Batches are limited to 50 payloads of at most 1 KiB plus envelopes. Existing organization write serialization, uncached privilege/RLS audits, five-connection pool default and 2s acquisition/5s transaction deadlines remain. This is not throughput certification. All events are retained; no retention, partitioning, CDC, quotas, archival, scheduled processing or backlog UI is added. Future retention must preserve a durable monotonic counter/checkpoint contract before deleting high-water rows; current MAX allocation must not be used after arbitrary purge/renumbering. Privileged tenant/opportunity deletion cascades events, so operators must review retention and legal deletion together before consumer activation. Large/backlogged tenants, multi-instance fairness, tracing/cold-browser contention and real provider poolers remain unverified.

## Validation evidence

Validated 31 October 2026 IST, Node 24.19.0 / Chromium 154.0.8037.57. Synthetic fixtures only, separate local `_test` databases and loopback Mailpit. Normal application database and production databases were not migrated. No package installation, external engine, paid API or deployment was used.

| Check                                                                               | Actual result                                                                                                                                                                                                                                         |
| ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Existing official Prisma WASM generation                                            | PASS                                                                                                                                                                                                                                                  |
| Type-check / lint / formatting / build                                              | PASS before the environment disconnect; code and tests recovered intact                                                                                                                                                                               |
| Unit                                                                                | PASS: 157 tests, 16 files                                                                                                                                                                                                                             |
| Direct PostgreSQL integration                                                       | PASS: 90 tests, 10 files                                                                                                                                                                                                                              |
| Isolated privilege fixtures                                                         | PASS: 30 tests; append-only outbox grants, missing-INSERT readiness and old-artifact rejection included                                                                                                                                               |
| Reused non-superuser migration owner                                                | PASS: 90 integration tests; 12 migrations/checksums and 14 protected table owners                                                                                                                                                                     |
| Fresh non-superuser migration owner                                                 | PASS: 90 integration tests; all 12 migrations plus repeat no-op application                                                                                                                                                                           |
| Actual PgBouncer 1.26.1                                                             | PASS: 90 integration tests through transaction mode, one backend, SCRAM and prepared statements                                                                                                                                                       |
| Strengthened event-specific negative fixtures                                       | PASS: 7 focused tests after removing duplicate-key masking from raw authorization negatives                                                                                                                                                           |
| Production auth-proxy HTTP simulation                                               | PASS: 2 groups; not real ingress/TLS                                                                                                                                                                                                                  |
| Actual Next HTTP / Server Actions                                                   | PASS, saved exit 0 at 2026-10-30T22:30:29.428Z; completed during the disconnect and was not repeated                                                                                                                                                  |
| Recovered full browser suite                                                        | PASS: 18 PASS groups, exit 0 at 2026-10-30T23:13:10.582Z after clean loopback server restart / CI prerequisites; includes real CRM create/replay event atomicity/privacy, entitlement denial, existing Clinic/calling and log/source-stability guards |
| Secret scan                                                                         | PASS: Gitleaks 8.30.1 redacted staged-diff scan, zero findings; not a full-history/environment scan                                                                                                                                                   |
| Hosted CI / production browser / real provider / production migration or deployment | NOT RUN / NOT AUTHORIZED                                                                                                                                                                                                                              |

The migration/pooler rows repeat the same suite under different connections, not additional unique tests. The seven outbox integration cases verify mutation/event/audit rollback, concurrent replay, duplicate semantic append rejection, bounded/replayed per-organization ordering independent of wall clocks, unscoped/foreign/dual-member and role denial, immutable grants and safe JSON, historical replay without fabricated events, and entitlement revocation/data retention. Three contract unit cases and five role-matrix cases are new. Two privilege cases are new. The existing actual CRM browser scenario now proves a replayed Server Action commits one safe event and does not render the private event UUID.

Recovery preserved all 22 changed/new files without reset, clean, reconstruction or package installation. Completed pre-disconnect checks were reused. The stronger raw-RLS fixtures use fresh, otherwise valid parent/sequence identities so a duplicate or unrelated constraint cannot impersonate an authorization failure; the seven focused cases passed after that test correction. Production behavior was not changed to satisfy a test.

### Retained failures and reliability limits

- The first recovered full-browser run failed at `browser-entitlements.ts:112`: the disabled-clinic SSE GET exceeded its existing 15-second client deadline while that route compiled. Recovery warm-up had omitted the anonymous SSE probe already present in `.github/workflows/ci.yml`. The later anonymous probe returned 401; the new outbox assertion had already passed in the failed run. No source or timeout change was made.
- The next run failed at `browser-clinic.ts:34` on an existing 20-second navigation deadline. Server diagnostics showed zero transaction timeout, decoder or application exception messages. These observations do not establish a complete root cause.
- Restarted only the owned loopback development server, preserving all source, database volumes and logs; performed the existing route/SSE prerequisites; kept source frozen and all assertions, role/security checks and deadlines unchanged. The complete suite then passed 18 groups. Warm development success does not prove reliable cold navigation, resource capacity, tracing under load or production browser behavior. Both earlier runs remain FAIL evidence, not silently replaced.
- Private evidence: `/tmp/bbd-event-checks/http.log`, `http-exit.json`, `browser.log`, `browser-rerun.log`, `browser-clean.log`, `browser-initial-exit.json`, `browser-second-exit.json`, `browser-exit.json` and private `server.log`. Raw logs/session-bearing diagnostics must not be committed or uploaded. The Next test server was stopped afterward; existing PostgreSQL/Mailpit state was preserved.

Independent human review remains required for producer lock/atomicity, event privacy, tenant/role/entitlement checks, immutable grants, sequence assumptions, migration/cutover/rollback and future consumer authority. Local tests do not establish production readiness.

## Changed-file manifest

22 changed/new files. Dependency manifests, lockfile and all eleven existing migrations are unchanged.

- `AGENTS.md`
- `ARCHITECTURE.md`
- `ROADMAP.md`
- `docs/EVENT_FOUNDATION.md`
- `prisma/migrations/202610310002_event_outbox/migration.sql`
- `prisma/schema.prisma`
- `scripts/browser-opportunities.ts`
- `scripts/verify-rls-migrations.mjs`
- `src/lib/runtime-privileges.ts`
- `src/lib/tenant-context.ts`
- `src/modules/crm/opportunities.ts`
- `src/modules/events/contract.ts`
- `src/modules/events/outbox.ts`
- `src/modules/organizations/access.ts`
- `src/modules/organizations/policy.ts`
- `tests/integration/contention.test.ts`
- `tests/integration/events.test.ts`
- `tests/integration/tenant-isolation.test.ts`
- `tests/privileges/runtime-privileges.test.ts`
- `tests/unit/database-readiness.test.ts`
- `tests/unit/events.test.ts`
- `tests/unit/policy.test.ts`
