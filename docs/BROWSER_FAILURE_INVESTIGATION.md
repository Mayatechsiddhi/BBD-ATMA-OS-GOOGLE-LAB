# Browser failure investigation — 30 October 2026 IST

Base: `606e5634821aea8351c37782a72049cfa95c59d9`, branch `security/audit-medium-hardening`. Synthetic local PostgreSQL/Mailpit only. No push, merge, deployment, dependency or migration change. Production business logic, authentication, database grants and tenant boundaries are unchanged.

**Overall: PARTIALLY VALIDATED; the aggregate browser matrix is FAIL.** The reproduced development decoder error has a minimal workaround and two complete suites passed afterward. One post-change verification-fixture timeout remains unresolved. No release approval is implied.

## Scope and diagnosis

The original failures were the display's empty-current-call wait after skip and the invitation form's hydration wait. Historical failing executions did not capture browser traces, so their exact causes cannot be retrospectively proven. Passing reruns must not be called a root-cause fix.

The first diagnostic calling run passed. Three alternating invitation and calling runs also passed before a complete suite failed at a different slot-validation UI wait. That failure has a concrete execution confound: the agent edited the test harness while the development server was running. The trace recorded the form POST at 21:07:29.814 UTC, the test file changed at 21:07:31.443 UTC, a webpack hot-update request followed about 6.7 seconds after the POST, then a fresh page/document and script downloads. The final screenshot showed the initial form without the expected alert. The agent caused this verification mistake; that run is retained as failed/confounded, not counted as an application regression or silently discarded.

Next's development debug-channel CLOSED-writable-stream messages occurred in passing runs too. They are retained in diagnostics, not suppressed or treated as proof of the application defect. CPU throttling is observed under the four-CPU quota, but observation alone does not establish it caused either historic timeout. Database sampling is aggregate/read-only at one-second intervals; it cannot exclude short waits or prove production capacity.

## Frozen baseline with the default debug transport

After freezing sources, invitation passed three of three focused runs. Calling passed two of three; the third failed at `browser-calling.ts:157` because Reception had been replaced by the application error boundary. Its console captured React RSC `TypeError: Cannot read properties of null (reading enqueueModel)` from `react-server-dom-webpack-client.browser.development.js:1782`, handled in `<Reception>`. The display continued receiving Call 1 through SSE. No source edit was detected. This is a reproduced client rendering/protocol failure; the exact historical skip-clearing wait was not reproduced in that execution.

The frozen complete suite then failed at `browser-clinic.ts:32` (the existing 60s wait). The server recorded two connection-timeout messages during Better Auth session lookup, failing closed with `FAILED_TO_GET_SESSION` HTTP 500. There were no P2028 or unsafe-runtime privilege errors. Read-only sampling saw no advisory-lock wait in 720 one-second samples (maximum seven connections across all local fixture/app/sampler processes). CPU throttling was observed; short waits and event-loop/connection starvation cannot be excluded. These resource failures are retained, not relabelled as successful tests.

## Minimal correction

- Opt-in private Playwright traces, masked screenshots, console/page errors, failed requests, script/document timing and SSE event metadata. No cookies, request bodies or raw credentials are printed in the sanitized summary.
- Focus selection reuses the exact existing invitation/calling assertions; default `all` still runs the complete suite. Invalid selection fails. Original 15s element and 20s navigation limits are unchanged.
- The runner invalidates a result if tracked/nonignored source files change during browser assertions, including same-content mtime edits that can trigger development reload. It does not skip or relax assertions, freeze source permissions, revert user work or claim to be a malicious-tamper detector. Three filesystem-backed unit regressions cover unchanged, touched and added files.
- Skip failures additionally record only persisted synthetic status/call count, skip-audit count and minimal display state, while preserving the original exception even if diagnostics fail.
- AGENTS.md requires repository/report/type-generation writes to finish before browser execution, with artifacts outside the watched checkout.
- `next.config.ts` sets the existing typed/schema-supported `experimental.reactDebugChannel` to false. The installed Next 16.4 declaration documents this as the **development-only** transport for React debug data; its fallback keeps debug data on the HTTP RSC stream. React's installed decoder reads the WebSocket debug stream and HTTP response into the same response object when the option is enabled. This is a narrowly scoped workaround for the observed development decoder failure, without patching vendored code or upgrading dependencies. Clinic SSE, auth, CSRF, rate limits, security headers, RLS and transaction deadlines remain unchanged. Reassess the workaround during a reviewed framework upgrade, with these browser regressions.
- All runs now fail on unhandled browser page errors or the known `enqueueModel` decoder console error, even if the UI later recovers. Expected denial HTTP statuses and no-JavaScript CSP blocking remain visible diagnostics, not suppressed or promoted to application defects.

## Reproduction and artifact handling

Use the existing local isolated test configuration, Node 24.19.0 and Chromium 154.0.8037.57. Follow the committed CI HTTP/warm-up sequence with the server bound to loopback; run each selected scenario in a fresh browser against the same server:

```sh
BROWSER_FOCUS=invitation BROWSER_ARTIFACT_DIR=/tmp/bbd-browser-UNIQUE-invitation BROWSER_SERVER_LOG=/tmp/PRIVATE-server.log npm run test:browser
BROWSER_FOCUS=calling BROWSER_ARTIFACT_DIR=/tmp/bbd-browser-UNIQUE-calling BROWSER_SERVER_LOG=/tmp/PRIVATE-server.log npm run test:browser
BROWSER_FOCUS=all BROWSER_ARTIFACT_DIR=/tmp/bbd-browser-UNIQUE-all BROWSER_SERVER_LOG=/tmp/PRIVATE-server.log npm run test:browser
```

Do not start formatting, type generation, report writes or edits until the browser process has completely exited. The guard covers Git-listed tracked/nonignored files, not every ignored/generated path; isolation of the execution remains necessary.

Standalone PNG inputs are masked; trace snapshots/frames remain raw and private. Raw artifacts stay under private `/tmp/bbd-browser-*` directories, with trace ZIPs mode 0600, private parents mode 0700 and masked input screenshots. **Raw traces contain synthetic authentication cookies/private links and must not be committed, publicly shared or uploaded as ordinary CI artifacts.** Fixtures are deleted after each run; no real patient data is used. Only sanitized counts and paths are recorded here. Artifacts are environment-local and may expire with the environment.

## Results

All eight post-change outcomes were retained. The wrapper exited **1**, as required by the failed fifth iteration.

| Iteration | Selection  | Result | PASS groups |
| --------- | ---------- | ------ | ----------- |
| 1         | invitation | PASS   | 9           |
| 2         | calling    | PASS   | 3           |
| 3         | invitation | PASS   | 9           |
| 4         | calling    | PASS   | 3           |
| 5         | invitation | FAIL   | 0           |
| 6         | calling    | PASS   | 3           |
| 7         | all        | PASS   | 16          |
| 8         | all        | PASS   | 16          |

Iteration 5 failed at `browser-invitations.ts:84`, the real email-verification API GET, with the existing 15s deadline. It failed before the first page was created and before the invitation form was exercised. No HTTP response status was available. The owner trace contains context options only: Playwright browser-context tracing did not retain those pre-page APIRequestContext transactions. The recorded line 84 refers to the pre-helper runner snapshot; later instrumentation shifted source lines. The exact transport/server cause is **not determined**, and this is not counted as a successful invitation repetition. No retry, timeout increase, direct verified-user mutation or auth bypass was added to make it pass.

The invitation form was successfully exercised in two focused runs plus both complete suites (four completed post-change executions). Calling/skip clearing passed in three focused runs plus both complete suites (five completed executions). The two full-suite runs each passed **16 groups**, including tenant/role denial, real invitation transport, native no-JavaScript forms, slots, scheduling, CRM opportunities, calling SSE, privacy, revocation and server-log secret exclusion. Group repetitions are not distinct test cases.

Post-change captured console: **0 enqueueModel errors, 0 CLOSED-debug-stream errors, 0 uncaught page errors**. Remaining messages: three HTTP 403 errors and seven HTTP 404 errors from negative access tests, plus 38 CSS preload warnings. Requests aborted by navigation/SSE cancellation and JavaScript blocked in the intentional no-JavaScript context remain recorded. They were not suppressed or fixed by weakening CSP.

After the configuration change: **137 unit tests PASS, 74 PostgreSQL integration tests PASS, lint PASS, type-check PASS, production build PASS, formatting PASS**. The three new unit cases cover source stability; all existing auth/roles/tenant/concurrency cases remain. No production credentials were used. Migration-role, pooler and production-auth-proxy suites were not repeated in this browser-only follow-up; their prior evidence remains in SECURITY_HARDENING_VALIDATION.md, not relabelled as new executions.

Resource observations after the workaround: four-CPU quota, 930 one-second database samples, one sample with an advisory wait, maximum eight connections across all fixture/app/sampler processes. Server log: **0 P2028, 0 unsafe-runtime privilege errors, 0 calling-action failures, 0 connection-timeout messages and 0 failed-session messages**. CPU throttling still occurred (1,799 throttled periods / 4,781 periods over 956 sampled seconds). This is not a matched-load performance benchmark or proof that starvation is eliminated; the post-change workload includes two full suites rather than one. Sampling can miss short events. The verification GET timeout remains unclassified despite those counters.

## Separate verification-fixture investigation — preserved workspace follow-up

No completed full-browser, PostgreSQL, build or 137-case unit suite was restarted. Only the newly added fixture checks and production-scope comparison were run.

**Development scope verified:** the installed `next/dist/build/define-env.js:77` emits `__NEXT_DEV_SERVER` as empty for production. Both initial hydration (`next/dist/client/app-index.js:151`) and navigation (`next/dist/client/components/router-reducer/fetch-server-response.js:61`) require that flag **and** `__NEXT_REACT_DEBUG_CHANNEL` before creating the debug channel. The installed option declaration explicitly describes development mode. A temporary configuration comparison against `git show 606e563:next.config.ts` passed in **both development and production**: all emitted security headers, logging configuration and powered-by handling are identical. No files under `src/`, migrations/schema or dependency manifests differ from 606e563. Authentication, tenant grants/RLS, CSRF, rate limits, verification requirements, transaction budgets and Clinic SSE are unchanged. This is source/configuration evidence, not a production ingress/browser attestation.

**Separate targeted verification:** `scripts/test-verification-fixture.ts` exercised six fresh synthetic users using actual `BrowserContext.request` before any Page is created, reproducing the original fixture transport shape. Every cycle rejected unverified sign-in with 403, consumed its real Mailpit link, required persisted `emailVerified=true`, and then accepted password sign-in with 200. Verification returned 302 in **116, 59, 46, 89, 84 and 37ms**. All six passed with the existing **15,000ms** request deadline and no retries. The targeted wrapper exited zero; fixtures were deleted by their own IDs. Evidence: `/tmp/bbd-browser-verification-target/step25.log` and `artifacts/verification-api.jsonl`. No full UI suite was repeated for this diagnostic-only helper change.

**Observability correction:** the main browser runner now reuses `scripts/browser-verification.ts`. It records only a fixed endpoint path, method, synthetic label, elapsed request time, response status, persisted fixture-verification boolean and error class. It never writes the verification URL/query, token, cookies, password, email or user ID. On failure it inspects only its own synthetic user's verification flag and preserves the original exception. Three additional targeted unit tests passed: original-timeout identity/deadline and redaction, rejecting HTTP success without persistence, and accepting the existing redirect only after persistence. The prior 137-case suite was not rerun or relabelled as 140 newly executed tests. Focused lint and type-check passed for the added diagnostics.

**Failure correlation:** the preserved failed context spans 18.36s. Nine CPU samples cover 16.9s, with about **3.4 cores used against a four-core quota**, 62 throttled periods out of 84 and 21,825,276 throttled microseconds (a cumulative counter, not a percentage of wall time). CPU sampling gaps reached 3.99s; database sampling gaps reached 3.15s near the failure. Database samples in the surrounding window contained active/idle client-read states, not database lock waits. Together with six fast isolated passes, this is consistent with resource/scheduling or transport starvation during the repeated-suite workload. It does **not** establish the precise request phase or exclude every application/driver cause: the historical request lacked per-request status/timing and persisted-state evidence. The original matrix remains **FAIL**; successful diagnostic reruns do not erase it. No timeout increase, automatic retry or authentication relaxation was introduced.

## Classification and outstanding work

| Failure                                                | Evidence-based classification                                                             | Disposition                                                                                                                                                               |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Historical invitation hydration wait                   | Exact failure not reproduced with traces; unique cause unproven                           | Do not claim retrospectively fixed solely from reruns                                                                                                                     |
| Historical display clearing after skip                 | Exact failure not reproduced with traces; unique cause unproven                           | Five completed post-change calling executions passed                                                                                                                      |
| Captured Reception enqueueModel error                  | Development RSC client decoder failure; guard confirms no repository edits                | Optional debug-transport workaround; no recurrence in completed post-change runs, no upstream root-cause proof                                                            |
| Captured slot validation wait                          | Test-execution confound: concurrent source edit and document hot reload                   | Frozen execution protocol and source guard added; original assertion retained                                                                                             |
| Baseline full-suite failed session/connection timeouts | Observed availability/resource/connection failure; no sustained lock pressure established | No recurrence in post-change server logs; capacity remains unproven                                                                                                       |
| Post-change verification GET timeout                   | Fixture cause undetermined; CPU-pressure correlation; historical pre-page trace gap       | **OPEN BLOCKER** for a wholly green matrix; redacted API/persistence instrumentation now added and six isolated cycles passed, but historic unique cause remains unproven |

## Private evidence index

- `/tmp/bbd-browser-calling-before-1/`: initial isolated calling PASS, server log and artifacts.
- `/tmp/bbd-browser-reproduce/`: exploratory alternating runs and the agent-confounded complete suite. `iteration-7-all/artifacts/owner.zip` records the hot update/document reload; `owner-0.png` is the masked final form.
- `/tmp/bbd-browser-frozen/`: baseline with source guard and default debug transport. `iteration-6-calling/artifacts/owner.zip`, `owner.json`, `owner-0.png` show the decoder stack/error boundary; display JSON shows the ongoing current-call SSE. `iteration-7-all/` records the session/connection failure. Aggregate/database/CPU samples and sanitized summary are retained.
- `/tmp/bbd-browser-debug-off/`: all eight predetermined post-change runs, their logs, snapshots, traces, `next-server.log`, `resources.json`, `database-resources.json` and `sanitized-summary.json`. `iteration-5-invitation/` retains the failed setup; `iteration-7-all/` and `iteration-8-all/` retain complete PASS evidence.
- `/tmp/bbd-browser-after-regressions/`: exact unit/integration/lint/type-check/build/format logs and exit-code manifest.
- `/tmp/bbd-browser-verification-target/`: six isolated real-auth verification cycles and redacted endpoint/persistence/timing records.
- `/tmp/bbd-browser-artifact-integrity.json`: archive integrity and private trace-mode verification. Raw evidence is local to this environment and intentionally excluded from Git.

Archive integrity verification completed: **98 trace ZIPs and 98 standalone PNGs** retained across the four evidence roots; every ZIP passed CRC/integrity checking and every trace ZIP has mode 0600. No raw trace, screenshot, server log, credential or database dump is committed.

## Remaining gates

A clean repeated run is evidence of current behavior, not proof that an intermittent historical defect is fixed. The precise classification of any unreproduced original timeout remains unconfirmed. Do not weaken timeouts or suppress framework errors to obtain a pass. Real ingress/TLS, managed pooler, production-mode browser/SMTP, deployment cutover/rollback and independent human security review remain outstanding as recorded in SECURITY_HARDENING_VALIDATION.md. Hosted Chromium 156 and hosted CI were not run in this task; no push is authorized.
