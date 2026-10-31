# Sprint 4 — workforce control-plane security review

Date: 31 October 2026, Asia/Kolkata. Reviewed branch: feat/durable-workforce-control-plane. Exact HEAD: 69cd00a7b9c0a4e3b6f424ee2b3ac9bf43eeda1f; parent 41b6b89e214bd34c400cb8c6068cd0b5489b625d. Working tree was clean at entry. Implementation is unchanged; this document is the only repository addition.

This is an adversarial AI engineering review in the same conversation that implemented the increment. **It is not an independent human security review.** Findings distinguish current defects, documented release gates and future integration hazards. No production database, external service, model, Paperclip installation, migration, push, merge or deployment was used. Existing tests ran only against their guarded local synthetic workforce fixture database; their normal fixture cleanup and temporary grant/trigger changes were confined to that database.

## Verdict and scope

**CONDITIONAL PASS** for continuing the closed, synthetic control-plane foundation. **Not approved for production or real agent execution.** No confirmed Critical or High exploit was established in the current no-route/no-network-adapter scope. Two Medium implementation gaps, two Medium operational/security release gates, and three Low hardening findings follow. Confidence is moderate: source review and fresh unit/workforce database tests support the core properties, but production ingress, human identity assurance, storage faults and real execution are not qualified.

A private read-only operator interface **may be developed next, locally and as a separate internal surface**, under the restrictions below. This is a development recommendation, not permission to deploy, expose an endpoint, install a coordinator or bypass the outstanding human review.

## Evidence collected

| Check                                                                                                                | Review-session result                              | Meaning                                                                                                                                                                                                                            |
| -------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Branch/HEAD/tree                                                                                                     | Verified exact commit; clean before review         | Source baseline established                                                                                                                                                                                                        |
| Unit                                                                                                                 | PASS: 198 tests, 20 files                          | Fresh execution; no implementation edits                                                                                                                                                                                           |
| Workforce PostgreSQL                                                                                                 | PASS: 22 tests, 1 file                             | Fresh execution through existing test runner; real signed sessions, company/role checks, restricted runtime, real child-process claims and fixture rollback                                                                        |
| Import-boundary adversarial probe                                                                                    | Confirmed gap: violations=[]                       | Virtual shared-contract source importing customer db was accepted; no such import was written or executed                                                                                                                          |
| Timezone probe                                                                                                       | Confirmed comparison mismatch                      | Read-only transaction on isolated workforce DB, SET LOCAL timezone followed by ROLLBACK; no session/user records accessed or changed                                                                                               |
| Workflow parser                                                                                                      | PASS: existing js-yaml                             | Syntax only, not actionlint semantic validation                                                                                                                                                                                    |
| actionlint                                                                                                           | UNAVAILABLE                                        | Not in PATH or searched existing /usr/bin, /usr/local/bin and shallow /opt/codex locations; no download/install attempted                                                                                                          |
| Existing app integration, privilege, migration-owner, pooler, HTTP/browser, auth-proxy, build/lint/type-check/format | Prior evidence inspected; NOT RERUN in this review | Sprint 3 records 110 app integration, 30 privileges, 110 legacy migration/pooler, 22 workforce pooler, 68 HTTP requests, 18 browser groups and 2 auth-proxy groups. These remain historical evidence, not fresh independent passes |
| Private ingress, human Founder/MFA, backups/restore, disk-full, hard process crash during execution, real adapters   | NOT VERIFIED                                       | Release gates, not implicitly passed by the 22-case suite                                                                                                                                                                          |

Private fresh logs: /tmp/bbd-workforce-review-69cd00a7/unit.log and workforce.log. Historical records remain under /tmp/bbd-workforce-durable and docs/DURABLE_WORKFORCE_CONTROL_PLANE.md. Pooler/migration repetitions overlap existing cases and must not be summed as unique security tests. Fresh workforce tests passed with existing assertions/deadlines unchanged. Local containers were returned to stopped state; volumes retained.

## Supported strengths

- Signed workforce cookies are verified using a separate Better Auth instance; identity is not taken from actor/role headers or task input. Fresh verified-user/session checks are followed by fresh membership checks under the company lock: src/modules/workforce-control-plane/control.ts:72–86; prisma/workforce/migrations/202610310001_workforce_control_plane/migration.sql:245–255. Signup and account deletion are disabled, cookie caching is disabled, and the cookie prefix/signing secret are separate: src/modules/workforce-control-plane/identity.ts:5–57.
- REQUESTER, APPROVER, EXECUTOR and FOUNDER are separate persisted authorities. Approver consent alone cannot claim a task. Founder approval generates an approval ID and bounded expiry; execution checks both current approver and Founder membership versions: first migration:317–339. Role separation and digest/version/expiry tests: tests/workforce/control-plane.test.ts:179–199,244–264,558–572.
- Task identity/updates and foreign keys include company. A known task ID in another company is not authority, including equal task UUIDs across companies. FORCE RLS with a transaction stamp denies missing/stale context, while scope is re-read under locks: first migration:191–234,298–300; tests/workforce/control-plane.test.ts:162–177,352–380,541–556.
- Claims, receipts and audit append commit together; versions and unique company/task/attempt receipts permit one committed claim. Existing tests include independent pools and actual child processes: first migration:336–357; tests/workforce/control-plane.test.ts:201–222,324–350,399–440. No lock spans mock computation.
- Runtime workers are non-owner/non-bypass and receive no direct business INSERT/UPDATE/DELETE/TRUNCATE grants. Definer functions revoke PUBLIC execute and fix search paths. Both broad grant drift and column grant-option drift are tested: src/modules/workforce-control-plane/database.ts:54–117; privileges.ts:15–30; tests/workforce/control-plane.test.ts:382–397,478–519,594–604.
- Closed schemas/digests, immutable runtime request fields and bound result checks prevent payload/approval substitution through the supported service: src/modules/workforce-contract/contract.ts:21–115; control.ts:95–142; prisma/workforce/migrations/202610310002_closed_contracts/migration.sql:2–33. These checks do not authenticate a process already holding database/signing credentials.
- Actual source inspection found no customer route importing the controller/mock and no controller customer-db/auth/CRM dependency. The only shared src/lib dependency is pool/transaction options. Separate schema/client and database preflight precede authentication queries: database.ts:9–83; control.ts:57–65. Customer models, migrations and business services are unchanged.

RLS confines trusted server queries; it does not contain arbitrary SQL execution with the runtime credential. That role also has global enclave-auth CRUD, and actor/session context can be forged by a compromised trusted process. This documented trust boundary means Paperclip/untrusted agent code must never receive database or signing credentials. It is not a newly discovered public authentication bypass.

## Findings ranked by severity

### M1 — MEDIUM: pre-execution authorization omits current approval-principal checks

**Kind:** confirmed source-level phase gap; current pure mock contains the impact. No unauthorized real-world effect was demonstrated.

**Evidence:** prisma/workforce/migrations/202610310001_workforce_control_plane/migration.sql:302–306 returns execution input after checking executor, task state, receipt, pause and time. It omits the active/role/version checks on approver and Founder present at lines 329–335. src/modules/workforce-control-plane/control.ts:109–138 then calls the adapter before entering the finish transaction.

**Failure scenario:** approve and claim a task, then Founder disables its approver. Task approvalState remains APPROVED. execution-input can still succeed and compute the mock; finish rejects because it finally checks the disabled approver. No result commits now. Replacing the pure adapter with a side-effecting adapter would perform work before that denial. Similar reauthorization races remain between precheck and any future external effect.

**Existing coverage:** stale approver version before claim (tests/workforce/control-plane.test.ts:558–572), principal/session revocation before the next action (606–618), and task revocation/finish races (265–288,442–459). These do not assert that the adapter is never invoked after approval-principal disablement between claim and execution-input.

**Minimum correction:** reuse one authoritative eligibility check for claim, execution-input, finish and retry. Before any real adapter, add fenced execution authority/revocation semantics at the actual effect boundary; repeating only the final check is insufficient.

**Missing tests:** claim → disable/version-change approver → completeMock must deny before adapter invocation; equivalent Founder-state change via isolated owner fixture; forced revocation/pause immediately before adapter dispatch. Keep current finish rejection as defense in depth.

### M2 — MEDIUM: member-disable audit events omit the affected principal

**Kind:** confirmed current audit completeness defect.

**Evidence:** prisma/workforce/migrations/202610310001_workforce_control_plane/migration.sql:269–274 updates the selected member but appends only companyId, actorId, action and the target's version. No subject user ID is stored. prisma/workforce/schema.prisma:115–123 has no audit subject field; taskId is NULL for this action.

**Failure scenario:** disable two members whose previous version is zero. The resulting events both identify the Founder and version 1, but not which member each event affected. Historical attribution cannot reliably be recovered from current membership state, especially after privileged maintenance or reactivation. This weakens incident investigation and evidence of access revocation.

**Existing coverage:** tests/workforce/control-plane.test.ts:606–618 checks that the disabled executor loses access; it does not inspect the member.disabled event's target.

**Minimum correction:** add an opaque, company-scoped subject identity (or narrowly typed safe audit subject metadata), record the target and relevant before/after state atomically, and retain it independently of mutable member state. No emails, passwords or tokens belong in that event.

**Missing tests:** disable two distinct members at the same version and assert exact actor/subject attribution; foreign-company targets denied; audit failure rolls back disablement and its version change.

### M3 — MEDIUM: crash/unknown-claim and audit-storage recovery are not operationally qualified

**Kind:** documented production/real-executor gate, not a newly confirmed mock exploit. Current refusal to auto-reclaim is the safer default.

**Evidence:** prisma/workforce/schema.prisma:102–113 has receipt state but no lease/fencing/heartbeat/reconciliation fields. First migration:336–351 claims RUNNING and permits retry only from RETRYABLE_FAILURE. Task/approval expiry blocks later completion, while Founder revoke is the available terminal action. Even pause requires an audit INSERT (262–267); claim/finish also require audit insertion (357). Recovery limitations are acknowledged in docs/DURABLE_WORKFORCE_CONTROL_PLANE.md:38–44.

**Failure scenario:** kill a worker after claim commit; receipt stays CLAIMED and task RUNNING. Once approval/task expires it cannot finish or retry. A lost response may leave completion outcome unknown. Separately, audit-storage failure rolls back pause/revoke; an already-running future external adapter cannot be stopped by an audit INSERT that cannot commit. No external adapter exists now, so no live external harm is established.

**Existing coverage:** restart test at tests/workforce/control-plane.test.ts:224–243 creates another controller in the same OS process and checks submission replay; it is not a hard-crash/backup-restore test. Child-process claims (399–440) prove contention, not crash recovery. Audit-trigger rollback (324–350) covers claim atomicity, not disk-full or emergency-control recovery.

**Minimum correction before real work:** retain no-auto-reclaim; define unknown-outcome reconciliation and fencing, independent worker termination/revocation controls, and approval-required recovery. Add retention/backpressure/capacity monitoring and backup/restore qualification. Never solve this by clearing receipts, extending timeouts or silently re-executing claims.

**Missing tests:** forced process exit after claim; lost commit response; stale worker returning after recovery; pause/revoke audit append failure; non-destructive storage-unavailable simulation; restore retaining receipts and approvals. Force both race orders with barriers and assert exact raced outcomes: the completion/revoke test at 442–459 repairs state after a conflict and only requires some raced command to succeed, so it is not proof the initial revoke always wins.

### M4 — MEDIUM: human Founder assurance and private ingress remain release blockers

**Kind:** acknowledged security gate; not a proven session-forgery vulnerability in the current unexposed library.

**Evidence:** src/modules/workforce-control-plane/identity.ts:32–58 configures password/session auth, with no MFA or step-up mechanism. It declares a client-IP header but supplies no authenticated ingress implementation that overwrites it. The controller explicitly has no transport (control.ts:55–56) and reads only cookies (75–77); it does not itself validate mutation Origin/CSRF. Test setup creates owner-provisioned users with emailVerified=true and role FOUNDER (tests/workforce/control-plane.test.ts:80–107); that is synthetic setup, not proof of human enrollment or verified physical Founder authority.

**Failure scenario if prematurely exposed:** an unsafe enrollment/recovery procedure binds FOUNDER to the wrong person, or stolen password/session credentials are used without step-up. A gateway that forwards generic command operations or trusts client IP headers could expose approvals/mutations or bypass intended abuse controls. Existing separation still requires approver consent, so password theft alone is not asserted to bypass every authority.

**Existing coverage:** genuine cookie sign-in, forged cookies/headers, role separation and session deletion are tested. No production MFA, Founder enrollment, CSRF-protected workforce mutation endpoint, trusted workforce gateway or deployment test exists. The legacy auth-proxy suite does not attest this separate enclave's ingress.

**Minimum correction before accessible operation:** reviewed Founder identity/enrollment/recovery, MFA/step-up for consent and sensitive controls, private TLS ingress, overwritten authenticated IP handling, cookie/domain review, transport-level CSRF/Origin/method checks, safe errors and authoritative operator binding. Do not copy fixture provisioning as a production enrollment procedure.

**Missing tests:** first-account/no-self-promotion, real enrollment proof, wrong/absent MFA, stolen/revoked session, malicious Origin, cookie-domain isolation, spoofed ingress headers and rate-limit behavior through the actual private gateway.

### L1 — LOW: import guard does not close dependencies through shared modules

**Kind:** reproduced enforcement gap; no current accidental customer import was found.

**Evidence:** scripts/workforce-import-boundary.ts:30–45 restricts customer dependencies only when the importing file is directly under workforce-control-plane. Shared workforce-contract and src/lib/database-options.ts are allowed at lines 32–40, but their own dependencies are not given the same restriction. Tests at tests/unit/workforce-boundary.test.ts:38–49 cover direct controller imports only.

**Reproduction:** called workforceImportViolations with the existing tsconfig, virtual filename src/modules/workforce-contract/contract.ts, and source `import { db } from "@/lib/db";`. It returned `[]`. No file/import was written or executed. Controller → shared contract → customer db could therefore pass this checker after a future change.

**Minimum correction:** extend the existing guard to enforce a transitively closed enclave dependency allowlist, or enforce purity on the allowed shared modules. No new framework is needed.

**Missing tests:** shared-contract/customer-db and shared-pool-options/customer-auth bridges, including barrels/aliases/dynamic imports. Retain direct route/mock import negatives.

### L2 — LOW: database session-expiry checks assume UTC without enforcing it

**Kind:** reproduced SQL comparison behavior; limited defense-in-depth/configuration risk, not a full expired-login bypass.

**Evidence:** prisma/workforce/migrations/202610310001_workforce_control_plane/migration.sql:20 stores Session.expiresAt as TIMESTAMP without timezone; visible/dispatch compare it against timezone-aware timestamps at 224 and 251. src/modules/workforce-control-plane/database.ts:54–117 does not check TimeZone. Deployment documentation requires UTC, and the previously tested database was Etc/UTC.

**Reproduction:** in a read-only transaction on the local test DB, set LOCAL timezone to Pacific/Honolulu, construct a UTC wall-clock timestamp expired one minute ago, and compare implicitly to clock_timestamp(): true (incorrectly looks live). Explicit AT TIME ZONE 'UTC' comparison: false. ROLLBACK restored the connection setting; no auth records changed.

**Impact boundary:** Better Auth independently validates the session before the SQL transaction. This does not demonstrate logging in with an already-expired cookie or ten extra hours of service access. It undermines the additional in-transaction expiry guard if a session expires between API validation and the DB check on a misconfigured connection.

**Minimum correction:** use explicit UTC semantics in both comparisons, or enforce UTC transaction/session settings and fail readiness on drift. Preserve authoritative expiry rather than extending it.

**Missing tests:** non-UTC backend with expiry between API lookup and transaction admission; equality at expiry; pool reuse after timezone changes.

### L3 — LOW: failed identity configuration leaves the opened client without explicit cleanup

**Kind:** confirmed source cleanup gap; configuration-triggered, not a demonstrated remote denial of service.

**Evidence:** src/modules/workforce-control-plane/control.ts:58–65 allocates the client and opens a readiness transaction, but the cleanup catch covers only readiness. workforceIdentity(db) can throw on missing/invalid secret/origin at identity.ts:7–31 after that catch. The caller then never receives close(). Idle connection cleanup is configured at src/lib/database-options.ts:13–16 (10 seconds), so a permanent connection leak is not asserted.

**Failure scenario:** a startup/retry path repeatedly constructs controllers with invalid auth configuration, transiently retaining pools/connections unnecessarily. No current public route can supply this configuration.

**Minimum correction:** cover all initialization failure paths with disconnect, or validate identity configuration before allocating/opening the database client while retaining preflight before authentication queries.

**Existing/missing tests:** environment guards are tested in tests/unit/workforce-environment.test.ts:1–28 and owner rejection at tests/workforce/control-plane.test.ts:594–604; missing-secret/invalid-origin-after-readiness cleanup is not tested. Add explicit disconnect/no-retained-connection assertions.

## Tooling and evidence gaps

Actionlint could not run from existing tools; no installation/network fetch was attempted. js-yaml parsed the workflow, but cannot validate GitHub Actions expressions, action schemas or runner semantics. Retain actionlint/hosted-CI verification as gaps, not security failures or successful lint claims. No current workflow defect was confirmed. No full-history secret scanner or live dependency advisory scan ran during this review. Raw fixture credentials/logs were not included in this report.

## Minimum next actions and operator-interface decision

1. Before real execution: address M1 and M2, qualify M3 recovery/fencing/kill controls and M4 identity/ingress. Do not replace mockAttempt with a model/network adapter in the meantime.
2. Before broader integration: close L1, make timestamp semantics explicit, and close initialization cleanup. Add the listed negative/forced-order tests to existing suites without altering their deadlines or suppressing failures.
3. A **local, private read-only operator interface can be developed next** using a separate internal process/surface. Do not add customer src/app workforce routes or weaken the import guards. Use a narrow authenticated facade exposing only read/audit, never a generic forwarded command operation. Scope every read to current membership; preserve requester-own-task restrictions. Return allowlisted synthetic task/receipt/audit metadata, not cookies, auth tables, private logs or customer data.
4. Include no approve, claim, retry, complete, pause, revoke, member mutation or auto-agent endpoints/buttons in that read-only sprint. Normal authentication-session maintenance is distinct from business mutation. Show stale RUNNING/CLAIMED as unconfirmed activity, not proof an agent is alive; preserve mock/human-review labels. Report denial/error states honestly, including a failed/conflicted revoke in any future mutating UI.
5. Actual accessibility/deployment requires approved private ingress, enrollment/session/MFA policy, secrets and backup/restore/operator review first. Developing the interface is not deployment approval and does not satisfy independent human review. Paperclip remains uninstalled and unconnected.

Only this review document was saved. No corrective implementation, source/config/test changes, commit, push, merge or deployment was performed.
