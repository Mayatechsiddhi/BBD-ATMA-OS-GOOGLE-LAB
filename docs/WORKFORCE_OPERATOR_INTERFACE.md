# Local read-only workforce operator

Latest local browser gate: **18/18 precompiled HTTPS groups PASS**; see “Latest gate — precompiled HTTPS browser fixture” below. Historical failures remain recorded. The local preservation review and included-file inventory are recorded at the end of this report.

Base: `a7083ed722142619d2bb95ea133d2d1a9840c141`, existing `feat/durable-workforce-control-plane`. This increment is intentionally uncommitted for review. It is not a production operator deployment or an independent human security review.

## Scope and boundaries

A separate loopback Node HTTP process renders React HTML using BBD's existing Card, Button, Input and compiled Tailwind stylesheet. There are no customer Next.js routes or customer database imports, client scripts, execution controls, agents, providers or new dependencies. The existing independent workforce database, Prisma runtime client, Better Auth identity, cookie/secret/origin separation and runtime privilege audit are reused. No schema, grants, customer migration, workforce migration or database is added.

The reader exports snapshot, sign-in and close operations only. It never imports the mutation controller or mock adapter. Import-policy regressions close indirect enclave edges, operator-script helpers and the reused pure UI dependency edges. This is a repository policy, not a JavaScript sandbox against a compromised process.

The server refuses production mode, missing explicit local opt-in, non-loopback origin/database, customer/owner database environment variables and databases outside the dedicated `bbd_workforce_*_test` namespace. It binds `127.0.0.1`, checks exact Host and Origin/fetch metadata, rejects forwarding/identity headers and limits request size, headers, duration and connections. Do not port-forward, tunnel or place this process behind an ingress. No public or production endpoint is introduced.

Authentication-session maintenance is the only write exception: POST `/sign-in` calls the existing Better Auth sign-in API. It does not mount an auth catchall, enrollment, verification bypass, account recovery or any business command. Existing accounts must already be verified and provisioned through the separate trusted fixture/operator process. Session/rate-limit maintenance can write auth tables; reading workforce tasks, approvals, receipts and audits cannot write business state.

## Authorization and read transactions

Only the signed workforce cookie supplies actor/session identity. A supplied company UUID is an untrusted selector, not authority. Every snapshot obtains fresh Better Auth session data, begins a PostgreSQL `READ ONLY` transaction, audits the restricted runtime role, takes the shared counterpart of the controller's exclusive company advisory lock and installs transaction-local actor/session/company/XID settings. Existing FORCE RLS rechecks verified user, unexpired session and active company membership. Final membership is rechecked before projecting the response. No global business query or mutation dispatcher is used.

Requester sees only their own tasks and associated receipts. Approver, Founder and Executor see company tasks; only Approver/Founder see company audits, matching existing dispatcher read rules. Foreign company/task IDs and unavailable scope return a generic denial. Role/approval/execution controls remain absent.

Shared locks serialize reads with ordinary controller membership/pause/revoke changes. Auth-session deletion outside those locks is checked by RLS on each statement and at the final membership read. A response authorized before later revocation cannot be recalled from a browser; no stronger immediate byte-retraction guarantee is claimed. Normal 2s acquisition/5s transaction deadlines and bounded connection pools are retained. Arbitrary runtime SQL or process compromise remains outside the protection supplied by this facade; its runtime role still has the existing private dispatch grant for the controller, while the reader's business transactions are database-enforced read-only.

## Privacy, ordering and uncertainty

- Requests and results are omitted from task database reads. No raw JSON payload, draft text, email, password, session, token, free-form error or raw member ID is rendered.
- Actor/subject/executor labels are deterministic per-company pseudonyms. Audit row labels are snapshot-local positions, not global audit sequence IDs or durable event identifiers. These are not anonymous identifiers and are not intended for external sharing. Opaque company/task/receipt IDs remain visible to authorized users.
- Tasks are bounded to 50 per page, ordered by UUID for stable keyset navigation, **not chronological order**. A selected task is separately authorized. At most three receipts per task and the latest 100 company audit events are shown. There is no export/search endpoint or background polling.
- Status/version/attempts, recorded approver/Founder attribution, approval expiry, task expiry and receipt/audit UTC timestamps are displayed. Task creation time is not a dedicated column in the current schema and is not inferred from UUID order.
- Every RUNNING task is labelled **Claimed — activity unconfirmed**. A missing/older-than-two-minute claim or expired task/approval becomes **Stale claim — outcome unknown**. This display heuristic is not a lease, heartbeat or authority to retry/reclaim/execute.
- Receipt binding matches are explicitly not successful-execution or test evidence. The schema has no task-specific verification-artifact record, so the page states **No task-specific test evidence recorded**. Global suite results are not fabricated as task evidence.
- All responses are no-store, with scripts disabled by CSP, frame denial and no cross-origin referrers. React escapes all text. There are no external assets or client-side tools.

## Local use

1. Use the already provisioned isolated synthetic workforce test database. Do not connect production or customer storage and do not create accounts through this UI.
2. Run `npm run build` to generate the existing shared BBD stylesheet.
3. In a separate clean local process provide **only** runtime workforce credentials: `WORKFORCE_RUNTIME_DATABASE_URL`, `WORKFORCE_AUTH_SECRET`, `WORKFORCE_AUTH_URL` (for example `http://localhost:3100`), `BBD_WORKFORCE_OPERATOR_LOCAL=1` and `NODE_ENV=development`. Keep database owner/customer/migration credentials out of that process. Do not paste secret values into reports or command history.
4. Run `npm run workforce:operator`. Open the configured URL on the same machine, sign in as a pre-provisioned verified synthetic workforce member, then select that member's company UUID. No credentials or permanent demo accounts are created by this increment.
5. Stop with Ctrl-C. This closes HTTP and the Prisma pool. No database/volume deletion is needed; preserve existing state. Browser tests clean up only their own random synthetic companies/accounts/tasks.

CI adds the isolated operator browser suite after the existing production build, reusing the already prepared workforce database and installed Chromium/Chrome. It does not publish a preview or run a deployment.

## Validation evidence

Validation performed locally on 31 October 2026 UTC, using PostgreSQL 17, actual restricted runtime roles, PgBouncer 1.26.1 transaction mode and Chromium 154.0.8037.57. Results refer to the uncommitted increment over the base above, not a new commit. Repeated invocations are not summed as additional unique coverage.

| Check                                                            | Result         | Exact evidence / boundary                                                                                                                                                                                                                                                                                                                                                             |
| ---------------------------------------------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm test`                                                       | PASS           | 214 tests: existing 210 plus four operator policy/privacy/import-boundary test cases with multiple negative assertions                                                                                                                                                                                                                                                                |
| `npm run test:integration`                                       | PASS           | 110 tests (90 PostgreSQL + 20 memory-store); existing customer authorization, tenant isolation, CRM/Clinic, entitlement/event behavior                                                                                                                                                                                                                                                |
| `npm run test:workforce`                                         | PASS           | 35 tests (30 preserved + five reader cases): signed sessions/forgery, company/task isolation, role-specific visibility, privacy/read-only business state, revocation/unverified/expired sessions, bounded pagination and lowercase identifiers                                                                                                                                        |
| `npm run test:privileges`                                        | PASS           | 30 tests against isolated fixtures                                                                                                                                                                                                                                                                                                                                                    |
| `npm run test:migrations`                                        | PASS           | 110 tests; existing dedicated non-superuser migration-owner fixture, idempotent deploy and owner/security-definer inventory; no new migration and no production migration                                                                                                                                                                                                             |
| `npm run test:pooler`                                            | PASS           | 110 application tests through actual transaction-mode PgBouncer                                                                                                                                                                                                                                                                                                                       |
| `npm run test:workforce:pooler`                                  | PASS           | 35 tests, including the final read facade and projections, through actual transaction-mode PgBouncer                                                                                                                                                                                                                                                                                  |
| `npm run test:http`                                              | PASS           | 68 requests against the existing local Next app; real email verification, authentication/CSRF, organization/tenant, CRM/Clinic and Server Action checks                                                                                                                                                                                                                               |
| `npm run test:workforce:operator:browser`                        | PASS           | 5 tests: actual form sign-in/303 response, stale claim/receipts/evidence privacy, requester/executor/company isolation, CSRF/ingress/write-endpoint rejection/no business mutation, no-JavaScript narrow-screen rendering; final run uses the same default Chromium sandbox setup as the existing suite                                                                               |
| Existing `npm run test:browser` (all)                            | FAIL           | 16 PASS groups, then `browser-calling.ts:103:16` authenticated display `page.goto` exceeded its unchanged 20,000ms deadline. Remaining calling/final-log assertions did not run in that invocation. Do not call the full suite green.                                                                                                                                                 |
| Focused existing calling browser rerun                           | FAIL then PASS | First rerun failed during signup fixture at `browser-invitations.ts:57:40`, unchanged 15,000ms API deadline. After restarting only the local test server and GET compilation warm-up, the focused run completed with 3 PASS groups: rate-limit regressions, calling workflow/security and secret-exclusion server-log check. Other full-suite groups were intentionally not repeated. |
| `npm run test:auth-proxy`                                        | PASS           | 2 tests; customer production trusted-ingress policy remains unchanged                                                                                                                                                                                                                                                                                                                 |
| Build / type-check / lint / formatting                           | PASS           | `npm run build`, `npm run typecheck`, `npm run lint`, `npm run format:check`; final production build includes TypeScript validation; no new operator route appears in the customer build                                                                                                                                                                                              |
| Workflow syntax                                                  | PASS           | Existing `js-yaml` parsed the workflow; `bash -n` passed for all 31 run steps                                                                                                                                                                                                                                                                                                         |
| `actionlint`                                                     | BLOCKED        | Executable unavailable; no package installed. YAML/shell checks are not actionlint equivalents.                                                                                                                                                                                                                                                                                       |
| Hosted CI / production ingress / production browser / scale load | NOT TESTED     | No push, deployment, production credentials, agent execution or large-scale workload authorized.                                                                                                                                                                                                                                                                                      |

Raw logs/exit records remain private under `/tmp/bbd-workforce-operator-validation`; operator snapshots/traces under `/tmp/bbd-browser-operator-*`; successful focused calling traces/screenshots and sanitized events under `/tmp/bbd-browser-workforce-operator-calling`. Traces can contain synthetic cookies/passwords and must not be committed or uploaded.

### Existing browser reliability investigation

The full-run failure coincided with the development server compiling `/display/[organizationId]/page`. No implementation changes were made to customer routes, calling code or existing tests. The first focused retry then stalled earlier during authentication. A separate 5-second health diagnostic also timed out while the Next process used about 97% CPU and 4GB resident memory; available host memory remained ample. The logs show compilation/aborted requests, not a demonstrated tenant authorization or database-privilege failure.

The local test server alone was restarted, preserving files/databases. Local unauthenticated GET warm-up included health, get-session and the existing CI route set; no browser assertion deadline was changed. The subsequent focused calling run passed; its retained display trace records HTTP 200 with response-start approximately 1,301ms and response-end 1,334ms. This supports development-server compilation/responsiveness as a likely factor, but does not establish a complete root cause, rule out an application defect or prove production behavior. A clean, reproducible full-suite run remains a review/release gate. There is no retry, skip, timeout increase or customer-framework change in this patch.

Initial implementation checks caught and corrected:

1. Five reader tests failed because Prisma could not deserialize PostgreSQL's `void` advisory-lock result. Casting the result to text fixed the query without changing locks. Subsequent reader tests enforced the pre-existing lowercase UUID contract rather than accepting noncanonical identifiers.
2. Initial build/typecheck caught an overly narrow test-environment type; the policy now accepts a readonly string environment map without weakening runtime checks.
3. Initial operator browser run: 3 passed, 2 failed. Actual sign-in POST was 403, with Chromium sending `Origin: null` under `Referrer-Policy: no-referrer`. `same-origin` retains strict Origin/CSRF checks while suppressing cross-origin referrers; the browser test now asserts the actual 303 sign-in response. Expected, explicitly asserted 404 navigation errors are excluded by exact URL/message from unexpected console errors. No timeout or security assertion was relaxed. Rerun: 5/5 passed.

## Changed-file inventory

15 files; no files staged or committed by this task:

| File                                            | Change                                                                                                        |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `src/modules/workforce-control-plane/reader.ts` | Dedicated authenticated read facade, read-only transaction, bounded scopes and privacy/uncertainty projection |
| `scripts/workforce/operator.tsx`                | Loopback-only HTTP lifecycle, closed read routes and CSRF-protected sign-in                                   |
| `scripts/workforce/operator-policy.ts`          | Opt-in, origin/database/environment and request-origin/ingress guards                                         |
| `scripts/workforce/operator-view.tsx`           | React SSR using existing UI primitives and compiled CSS                                                       |
| `scripts/workforce-import-boundary.ts`          | Execution-path and pure-UI/operator transitive import restrictions                                            |
| `scripts/workforce/test.mjs`                    | Reuse isolated test setup for the separate operator browser config                                            |
| `tests/unit/workforce-operator.test.ts`         | Local configuration, request safety, privacy/claim uncertainty and import-policy regressions                  |
| `tests/workforce/reader.test.ts`                | Real PostgreSQL authentication, role/company isolation, privacy, revocation and pagination cases              |
| `tests/workforce-browser/operator.test.ts`      | Five actual Chromium/HTTP interface regressions; only synthetic random fixtures                               |
| `vitest.workforce-browser.config.ts`            | Isolated browser suite configuration                                                                          |
| `package.json`                                  | Two commands only; dependency versions and lockfile unchanged                                                 |
| `.github/workflows/ci.yml`                      | Existing CI gains local operator browser validation after build; no deployment                                |
| `ARCHITECTURE.md`                               | Implemented boundary summary                                                                                  |
| `ROADMAP.md`                                    | Continuity and remaining gates                                                                                |
| `docs/WORKFORCE_OPERATOR_INTERFACE.md`          | This implementation, usage, evidence and limitations report                                                   |

Preserved without changes: both Prisma schemas/all migrations, customer routes/services and tests, existing workforce mutation controller/contracts/mocks, package-lock, and both workforce security review/correction reports. HEAD remains the exact starting commit. No normal/force push, merge, production database operation or agent activation was performed.

## Remaining production gates

Independent human security review remains mandatory. Production operator ingress, MFA/Founder enrollment and recovery, operator access policy, machine identities, CSRF/session review behind any real gateway, backup/restore, operational retention/denial monitoring and storage-failure drills remain unverified gates. This local server deliberately refuses production use. No task verification-artifact store, lease/heartbeat, unknown-claim recovery, automatic retry, external exactly-once guarantee, customer-data gateway or Paperclip/real-agent integration is introduced. Existing historical browser cold-start reliability limitations remain relevant and are reported rather than hidden. No paid service, production credential, push, deployment or real-agent execution is authorized by this increment.

## Phase 2 browser reliability gate — controlled follow-up

Result: **FAIL; not ready for the requested local preservation commit under this browser gate.** Exactly one full-browser invocation ran in this follow-up. No application, operator, migration, security-control or existing test source was changed. All 15 uncommitted paths were preserved; only this report was extended after the run. Existing security reviews remain unchanged. HEAD is still `a7083ed722142619d2bb95ea133d2d1a9840c141`.

### Controls and retained evidence

Private evidence directory: `/tmp/bbd-browser-reliability-W56Ykd`. It contains `browser.log`, `server.log`, `readiness.json`, source checksums, `result.json`, private traces/screenshots in `artifacts/`, driver diagnostics and verified cleanup metadata. Do not publish raw traces or logs: synthetic credentials can appear in them. Previous evidence directories were retained.

- Fresh Next development server on `127.0.0.1:3000`, existing PostgreSQL/Mailpit healthy, only dedicated local `_test` connections. No build, format, type generation, package operation, other test suite or source edit during the browser run.
- Readiness health was HTTP 200 in 538ms. The unauthenticated auth-session readiness GET and the existing CI GET warm-up routes succeeded; the anonymous calling route returned 401. No keep-alive warm-up or readiness polling ran during browser assertions.
- Existing `BROWSER_FOCUS=all`, Chromium 154.0.8037.57, assertions and timeout settings were retained. Browser elapsed time, including diagnostic capture and cleanup: **85,084ms**; exit 1, completed `2026-10-31T20:19:45.650Z`.
- SHA-256 comparison of all tracked/untracked nonignored repository files before/after the suite: **zero content changes**. The existing source-stability/rendering guard did not report a mutation or decoder failure.
- Trace review of the earlier focused calling run confirms display HTTP 200 with response-start about 1.3s; the earlier full display navigation timeout remains historical evidence, not a clean full-suite pass.

### Exact results from this invocation

Seven PASS groups:

1. Auth rate limits: shared IPv6 /64 blocked on fourth attempt, independent client isolated; existing signup/sign-in limits unchanged.
2. Hydrated invitation POST and private link (2,621ms).
3. Tenant B replay of tenant A invitation POST denied without persistence.
4. Forged OWNER payload rejected without creating an invitation.
5. Same invitation form recovers after forged OWNER rejection and creates a fresh invitation.
6. Wrong recipient denied; matching recipient accepts; replay denied; atomic membership/audit.
7. Unhydrated authentication/recovery forms cannot submit credentials through GET.

**FAIL:** native no-JavaScript invitation scenario. `scripts/browser-invitations.ts:340` navigated to the members page, then `submit()` at line 112 waited for the missing Email address field and exceeded its unchanged 15,000ms fill deadline. The trace proves that the preceding GET returned **HTTP 500**, with approximately **3,407ms** total network duration (response wait approximately 3,396ms). The document was complete but contained no invitation form. This is not evidence of slow hydration: JavaScript was intentionally disabled and the server returned an error page.

**NOT REACHED in this invocation:** successful native no-JavaScript invitation persistence; Clinic/slot/schedule/CRM/opportunity/entitlement groups; calling-display navigation and call/recall/skip/complete; final server-log exclusion group. Historical passes elsewhere in this report do not change these statuses.

### Failure isolation

The server log records the causal chain at `2026-10-31T20:19:26.948Z`:

- `requireSession()` (`src/lib/session.ts:5`) calls Better Auth `getSession()` for the members page.
- Its Prisma/pg connection fails: **Connection terminated due to connection timeout**, caused by **Connection terminated unexpectedly**.
- Better Auth returns **FAILED_TO_GET_SESSION**; members GET returns 500. The browser subsequently reports the less useful missing-field timeout.

`src/lib/database-options.ts` still sets connection acquisition to 2,000ms, idle timeout to 10,000ms, maximum pool size five, and unchanged Prisma 2s acquisition/5s transaction budgets. The exact error wrapper comes from `node_modules/pg-pool/index.js:276` after its new-client connection deadline fires. There was no recorded PostgreSQL FATAL/PANIC/restart/termination in the retained database log for the run. This does not rule out every transient network/database delay.

A separate, no-write diagnostic after teardown used the same local restricted runtime database and the same 2s connection deadline:

| Diagnostic                                                                   | Result                                                    |
| ---------------------------------------------------------------------------- | --------------------------------------------------------- |
| Fresh pg pool, no deliberate delay                                           | Connected and `SELECT 1` succeeded in 26ms                |
| Fresh pg pool, deliberate 2.5s block of that diagnostic process's event loop | Failed in 2,508ms with the **exact same error and cause** |

This reproduces the failure mechanism without altering the application or its budgets. Development compilation/event-loop pressure is a plausible common factor in the earlier navigation stall and this connection failure, **not a proven root cause of both**. A manual process snapshot during the run showed the Next process at about 123% cumulative CPU and 2.1GiB RSS. The initial automatic `/proc` metrics parser failed, yielding empty samples; corrected sampling started after the critical interval. Those empty samples must not be interpreted as zero resource use, and continuous event-loop/handshake timing remains unverified.

The evidence establishes a server-side connection-acquisition failure and a test-diagnostic gap. It does not establish an authorization bypass, tenant leak, leaked SSE transaction, pool exhaustion, PostgreSQL crash or operator-interface regression. The earlier calling timeout was **not reproduced or cleared by this full invocation**, because execution stopped earlier.

### Cleanup and proposed smallest next correction

Independent post-run checks confirmed no active Next/Chromium processes, no port 3000/3100 listener and no remaining connections to the application test database (excluding the short-lived diagnostic connection). No idle-in-transaction session remained. Server shutdown exited 0. The existing SSE implementation clears timers/listeners on abort/cancel, rechecks authorization on snapshots and holds no idle transaction between ticks; no cleanup correction is justified by this evidence. Databases, volumes and previous traces were preserved.

Recommended next patch, **not implemented here**:

1. Add explicit navigation-response status assertions before form access at `scripts/browser-invitations.ts:340` and `scripts/browser-calling.ts:103`, using existing deadlines. A 500 must fail at its real request rather than masquerade as a locator/navigation synchronization issue. Do not skip the native form or invitation persistence assertions.
2. Prepare a dedicated **precompiled local browser-server fixture**, reusing the isolation/runtime-credential and trusted-ingress approach in `scripts/test-auth-proxy.mjs`, to remove development compilation from timed authentication/database work. Full real-browser support must include valid origin, secure-cookie/TLS and overwritten trusted-ingress headers; merely overriding NODE_ENV, trusting caller headers or disabling TLS/CSRF is not acceptable. This fixture still requires design/code review and validation; its success is not assumed.
3. If development-mode reliability remains an acceptance gate, add privacy-safe event-loop-lag/connection-phase diagnostics and profile only the affected requests before selecting a compiler/pool-lifecycle correction. The exact reason the real connection handshake missed 2s remains unproven. Do not increase assertion or database deadlines, keep sockets artificially alive, add automatic retries, reduce tenant checks or change production grants to obtain green results.

The operator implementation's prior unit/database/pooler/HTTP/operator-browser/build passes remain historical evidence on byte-identical code. They were not needlessly repeated, and they do not override this failed full-browser gate. Independent human security review and the existing production enrollment/MFA, ingress, backup/recovery and real-agent gates remain mandatory. No commit, push, deployment, package installation or agent activation occurred.

## Latest gate — precompiled HTTPS browser fixture

**PASS — ready for a local preservation commit after review. No commit was created.** Completed `2026-10-31T21:12:08.469Z`, full browser process exit 0, **18/18 PASS groups**. This supersedes the earlier _local browser gate_ blocker, not the historical failure evidence or production/human-review requirements. HEAD and branch remain unchanged. No production configuration, authentication/service source, database deadlines, grants or migrations changed.

### Implemented correction

`browser-navigation.ts` asserts a successful HTTP status before form queries and reports only a fixed phase label, HTTP status and elapsed time. It preserves every existing goto option/deadline. The development regression exposed a legitimate edge case: Playwright returned null from `goto` during a client navigation although the trace recorded the matching HTTP 200 document. The helper now captures that same main-frame navigation response, requires its target/final URL to match, and checks its actual status. It does not perform another request, retry, reuse an old status or accept an unverified null response. Regressions cover both matching 200 and 500 responses.

`npm run test:browser:precompiled` runs the existing complete browser suite against the existing production build on loopback. It uses:

- Production-mode Next on 127.0.0.1:3200; restricted-role/grant readiness before startup, migration/owner and unrelated environment credentials masked, fresh synthetic auth/gateway secrets.
- Verified HTTPS on localhost:3443 with a one-day local CA and localhost/127.0.0.1 leaf certificate. Node rejects the untrusted CA and accepts it only with explicit fixture CA trust. Direct auth requests to the backend without attestation return 403; caller-spoofed gateway/IP headers without a registered fixture identity return 403.
- A private Chromium NSS trust database under the fixture `/tmp` directory. The attempt to obtain host NSS write permission returned no grant; **no CA was installed in the host trust store**. The final solution runs the installed Chromium binary/libraries read-only inside a disposable cached-image container, using the caller's numeric UID and an isolated XDG data directory. No HOME override, certificate-error ignore switch, TLS exception or dependency download is used. Chromium uses its existing Playwright-default sandbox setting; container read-only filesystem, dropped capabilities and no-new-privileges add isolation.
- The already installed/pinned Mailpit image is reused for both disposable test containers; no new image is pulled. The Chromium container entrypoint is Chromium, not a database/mail server. The mail container requires authenticated STARTTLS, accepts only synthetic example.com recipients and has no relay/forwarding configuration. Only its leaf cert/key and private SMTP auth file are mounted; browser mounts contain the public-CA NSS store, not CA signing keys or mail/gateway credentials. Existing Mailpit and PostgreSQL containers/volumes are not reconfigured.
- Real production Better Auth verification, Secure session cookies, CSRF/origin checks and server-overwritten ingress headers. Per-client synthetic credentials map to server-owned IPv6 identities; untrusted XFF is never the production authority. The real gateway key is not passed to the browser test process. Original rate-limit tests and limits remain unchanged.
- A fixture-only event-loop preload emitting numerical timing/utilization/RSS samples, never request bodies, headers, query parameters, session data or credentials.

All fixture listeners (3200, 3443, 9223, 1465, 8026) were observed on loopback. The two disposable containers, precompiled server and gateway were stopped/removed after the successful run. No new BBD database or production resource was created. Raw artifacts remain private and must not be published.

### Complete browser results

All existing assertions, negative security cases, native forms and timeout values were retained. The full run and its source-stability/rendering guard exited successfully:

1. PASS auth rate limits: shared /64 throttling, isolated independent client, unchanged signup/sign-in limits.
2. PASS hydrated invitation POST and private link (384ms).
3. PASS cross-tenant invitation POST replay denial without persistence.
4. PASS forged OWNER payload rejection without invitation creation.
5. PASS same-form recovery following forged OWNER rejection.
6. PASS recipient authorization, acceptance, replay rejection and atomic membership/audit.
7. PASS unhydrated auth/recovery credential GET-submission prevention.
8. PASS native no-JavaScript invitation POST and exactly-once persistence.
9. PASS clinic lead creation, IST booking, agenda and confirmation.
10. PASS cross-tenant clinic pages and captured booking action rejection without writes.
11. PASS slot validation/empty results, cross-tenant denial, stale-conflict rejection, explicit booking and duplicate POST rejection.
12. PASS working hours, breaks, duration, leave, booking-conflict preservation and schedule authorization.
13. PASS rescheduling/cancellation, persisted follow-ups, dashboard and read-only member UI.
14. PASS exactly one safe transactional outbox event for CRM create/replay without envelope exposure.
15. PASS opportunity lifecycle, INR persistence, duplicate submission, search, tenant denial and member permissions.
16. PASS entitlement owner changes, disabled routes/SSE, member restrictions, foreign/replayed actions and audit.
17. PASS patient registration, doctor queue, cross-screen SSE call/recall/skip/complete, privacy, foreign-stream denial and revoked-display clearing.
18. PASS existing server-log exclusion for fixture passwords, verification URLs, invitation tokens and clinic search values.

Other current checks: **217 unit tests PASS**, type-check PASS, lint PASS with **two existing standalone-SSR UI warnings and zero errors**, formatting PASS, production build PASS. The current app artifact was built before fixture testing and app source was not changed afterward. Prior PostgreSQL integration/privilege/migration-owner/pooler/operator-browser results remain recorded above; those unchanged suites were not unnecessarily repeated for test-infrastructure-only changes. Hosted CI was not run or configured to use the new fixture.

### Proven findings versus hypotheses

- **Proven earlier:** the authenticated members page returned 500 because a new pg-pool client missed its unchanged 2s connection deadline. The old locator timeout obscured that real server error; this is now diagnosed at navigation.
- **Proven mechanism:** the retained independent database diagnostic connects normally in 26ms but reproduces the exact error/cause when its own event loop is blocked for 2.5s. This does not prove that every earlier failure had the same trigger.
- **Measured in the development attempt:** HTTP-server process event-loop delay reached about 1,751ms (separate compiler workers exceeded 3s). That attempt passed 13 groups, then the new helper's null-response assumption failed despite an actual CRM HTTP 200. The helper defect was corrected and regression-tested; the artifact is retained, not reported as an application failure or a full pass.
- **Measured in the successful precompiled run:** 55 HTTP-server samples, maximum event-loop delay **375.39ms**, maximum RSS **407MiB**; all 18 groups, including calling-display navigation, passed. This removes development compilation from the timed request path. It is one local success, not a statistical reliability/load guarantee or proof of the original display timeout's sole cause.
- Initial readiness alone cannot guarantee all later connection acquisitions. No database deadline, pool size, authorization/RLS check or retry policy was changed. No PostgreSQL crash, tenant leak or persistent SSE/database resource leak was established. Existing development-mode cold-compilation behavior is not claimed fixed.

Evidence: `/tmp/bbd-browser-precompiled-7vAc8L` contains the successful `result.json`, full `browser.log`, server/event-loop logs, private browser traces/screenshots and per-attempt bootstrap diagnostics. `/tmp/bbd-browser-reliability-zFCJW1` retains the development attempt and observed HTTP 200/null-goto evidence. Earlier failure directories listed above remain intact. Early TLS bootstrap failures (host trust unavailable, private NSS ownership/mount configuration and directory reuse) were resolved using the isolated trust store, not TLS bypasses; their available logs/attempt records remain private. Generated cert/key, token and SMTP-auth files are private test credentials; never commit/upload the fixture directory.

### Exact paths touched in this reliability increment

The original 15 operator paths are preserved. Only package commands and this report were extended within those 15; the other 13 original paths and both security-review documents are unchanged. There are **31 uncommitted paths total**, with **18 touched by this reliability increment**:

| Path                                         | Change                                                                       |
| -------------------------------------------- | ---------------------------------------------------------------------------- |
| `scripts/browser-navigation.ts`              | Checked navigation and matching-document response handling                   |
| `scripts/browser-invitations.ts`             | Checked navigation, optional local CDP/identity/mail fixture inputs          |
| `scripts/browser-calling.ts`                 | Checked reception/display navigation                                         |
| `scripts/browser-clinic.ts`                  | Checked existing positive clinic navigations                                 |
| `scripts/browser-entitlements.ts`            | Checked existing positive entitlement navigations                            |
| `scripts/browser-opportunities.ts`           | Checked existing positive CRM navigations                                    |
| `scripts/browser-slots.ts`                   | Checked existing positive slot navigation                                    |
| `scripts/browser-schedules.ts`               | Checked existing positive schedule navigations                               |
| `scripts/browser-client-ip.ts`               | Reuse attested client headers in existing rate-limit cases                   |
| `scripts/browser-fixture-client.ts`          | Private per-client fixture credential lookup; original dev behavior retained |
| `scripts/browser-fixture-gateway.ts`         | Closed attestation/host checks and server-owned ingress-header replacement   |
| `scripts/browser-fixture-chromium.mjs`       | Isolated private browser trust/container lifecycle using installed binaries  |
| `scripts/browser-event-loop.mjs`             | Opt-in numerical event-loop diagnostics                                      |
| `scripts/test-browser-precompiled.mjs`       | Precompiled HTTPS/mail/browser fixture and cleanup                           |
| `tests/unit/browser-navigation.test.ts`      | HTTP-error/privacy/null-response navigation regressions                      |
| `tests/unit/browser-fixture-gateway.test.ts` | Missing/forged/malformed identity and overwritten-header regressions         |
| `package.json`                               | One additional local test command; dependencies/lock unchanged               |
| `docs/WORKFORCE_OPERATOR_INTERFACE.md`       | This preserved chronological evidence/report                                 |

### Run and remaining gates

Run `npm run build` followed by `npm run test:browser:precompiled` with the existing local synthetic test-database configuration. Prerequisites are already installed Linux Chromium/libraries at the fixture paths, Docker with the pinned Mailpit image cached, OpenSSL and certutil. No command installs missing software or changes the host certificate store. `--prepare` prepares a private cert directory only; `BBD_BROWSER_FIXTURE_DIR` may select that same directory for the run. Certificates expire after one day, so prepare a fresh directory after expiry. No public preview is published.

**The requested local preservation-commit gate is satisfied, pending the user's review/commit authorization.** No files are staged, no commit/push/merge/deployment was performed, and no real agents were enabled. Independent human security review remains mandatory. Production ingress/MFA/enrollment/recovery, operator deployment, real-agent execution, scale testing and hosted-CI portability remain separately reviewed gates. The fixture is currently tailored to this installed Linux environment; do not assume another CI runner has matching browser paths/certificate tools or change CI/deployment automatically.

## Local preservation review

This section records the review for the user-authorized local preservation commit, `feat(workforce): add read-only operator interface and browser harness`. The full commit hash is recorded by Git rather than embedded in the committed file. Earlier sections are chronological development evidence, including then-uncommitted status and failures; they are not rewritten as clean historical passes.

All 31 candidate paths were reviewed against the implementation and browser reports. No unrelated feature, generated asset, raw log/trace, database file, certificate, private key, environment file or actual local secret value was found in the candidate set. Secret-pattern checks found no matches. The initial comparison covered five distinct local secret/credential values; final staged-content comparison covered twelve local/test secret values, including fixture client credentials and the synthetic SMTP password, with no matches. Gitleaks was unavailable; no scanner was installed and no dedicated-scanner pass is claimed.

One narrow fixture issue was confirmed and corrected before preservation: PostgreSQL query parameters can override an apparently loopback URL hostname. The precompiled fixture now rejects connection/database/schema overrides, requires PostgreSQL loopback `_test` URLs with the same host/port/database and separate owner/runtime roles, and validates them before opening connections. A no-connection probe reproduced the old override behavior; the added regression covers host, port, database, schema and role mismatches. This changes test setup only, not application authentication, RLS, grants or deadlines.

Final validation after that correction: **218 unit tests PASS**, type-check PASS, lint **zero errors/two existing warnings**, complete precompiled HTTPS browser **18/18 groups PASS**, browser exit 0 at `2026-10-31T21:25:43.599Z`. The unchanged application production build passed in the preceding increment. Final formatting and staged whitespace checks accompany preservation; hosted CI and actionlint remain unverified/unavailable as recorded above.

The fixture remains loopback/test-only, with validated local database destinations, verified certificate chains, private isolated browser trust, authenticated STARTTLS capture, real signed/verified Better Auth sessions, CSRF/origin checks and server-overwritten ingress identities. No TLS bypass, deadline increase, public route, production configuration edit, package dependency change, billing integration or real-agent execution is included. The operator remains explicit-opt-in, non-production and read-only for business records. Existing customer auth/tenant sources, schemas/migrations, package-lock, AGENTS/SECURITY policies and both workforce security review/correction documents are unchanged.

The remaining lint warnings are `@next/next/no-head-element` and `@next/next/no-css-tags` at the standalone React SSR `<head>` and stylesheet link in `scripts/workforce/operator-view.tsx` (lines 37 and 41). They are retained rather than suppressing rules or altering the working local renderer.

Raw failure/success artifacts remain private under the `/tmp` locations above and are excluded from this commit. All disposable browser/mail containers and fixture listeners were cleaned up after validation. Independent human security review, hosted-CI portability and the existing production gates remain mandatory. This preservation operation does not authorize pushing, merging or deploying.

### Included files (31)

- `.github/workflows/ci.yml`
- `ARCHITECTURE.md`
- `ROADMAP.md`
- `package.json`
- `scripts/browser-calling.ts`
- `scripts/browser-client-ip.ts`
- `scripts/browser-clinic.ts`
- `scripts/browser-entitlements.ts`
- `scripts/browser-invitations.ts`
- `scripts/browser-opportunities.ts`
- `scripts/browser-schedules.ts`
- `scripts/browser-slots.ts`
- `scripts/workforce-import-boundary.ts`
- `scripts/workforce/test.mjs`
- `docs/WORKFORCE_OPERATOR_INTERFACE.md`
- `scripts/browser-event-loop.mjs`
- `scripts/browser-fixture-chromium.mjs`
- `scripts/browser-fixture-client.ts`
- `scripts/browser-fixture-gateway.ts`
- `scripts/browser-navigation.ts`
- `scripts/test-browser-precompiled.mjs`
- `scripts/workforce/operator-policy.ts`
- `scripts/workforce/operator-view.tsx`
- `scripts/workforce/operator.tsx`
- `src/modules/workforce-control-plane/reader.ts`
- `tests/unit/browser-fixture-gateway.test.ts`
- `tests/unit/browser-navigation.test.ts`
- `tests/unit/workforce-operator.test.ts`
- `tests/workforce-browser/operator.test.ts`
- `tests/workforce/reader.test.ts`
- `vitest.workforce-browser.config.ts`
