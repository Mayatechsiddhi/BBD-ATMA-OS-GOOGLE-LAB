# Medium-finding hardening — local validation

Date: 29 October 2026 UTC. Branch: `security/audit-medium-hardening`. Base: `fb9aa2c77622a4d9ad6f0c53d03018a6b3352f4d`. This report describes local synthetic databases only. Nothing was pushed, merged or deployed; hosted CI was not run.

## Baseline and scope

Baseline is the consolidated read-only audit and the owner-supplied condensed Claude PR #7/PR #6 static review. Claude executed no tests; the full original review transcript was not supplied. Its no-Critical/no-High assessment is not a production security attestation. See `SECURITY_HARDENING.md` for the implementation and operator contract.

M1: shared read/display locks; exclusive mutations and revocations; uncached runtime ACL/RLS audits retained. Explicit unchanged Prisma 2s/5s budgets, bounded PostgreSQL pool and lightweight public connectivity check. M2: production HTTP auth requires a gateway-attested client IP and private gateway key; forged forwarded headers cannot select the rate-limit identity. M3: additive grant-plan generation from the allowlist, strict required/excess startup checks, read-only migration preflight and isolated-role regression tests. Original migrations and lockfile are unchanged. No dependencies were added.

## Executed local checks

| Check                                           | Baseline                           | Current result                                                                                                    |
| ----------------------------------------------- | ---------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Unit                                            | 117                                | PASS: 134                                                                                                         |
| Isolated runtime privilege tests                | 22                                 | PASS: 26                                                                                                          |
| PostgreSQL integration                          | 71; earlier P2028 timeout          | PASS: 74                                                                                                          |
| Reused non-superuser migration-owner fixture    | 71                                 | PASS: 74                                                                                                          |
| Fresh non-superuser migration-owner fixture     | Not in baseline                    | PASS: 74; migrations applied twice                                                                                |
| Transaction-mode PgBouncer                      | 71                                 | PASS: 74                                                                                                          |
| Read-only database readiness                    | Not in baseline                    | PASS: 10 checksummed migrations; required/excess grants and RLS                                                   |
| Production-mode auth HTTP                       | Not in baseline                    | PASS: 2 groups; missing/forged assertions, malformed IP, signup/sign-in throttle and independent attested clients |
| Lint, type-check, formatting, production build  | PASS                               | PASS                                                                                                              |
| Existing HTTP/Server Actions                    | PASS                               | PASS twice: auth/verification, CSRF, tenant-denied pages/actions, CRM and clinic persistence/audit                |
| Complete development-mode browser suite         | 16 groups passed on baseline rerun | **FAIL**: 14 groups then display timeout; rerun one group then hydration timeout                                  |
| License inventory                               | Existing                           | PASS: 819 lock records, no unknown declarations; no new dependency                                                |
| npm audit, production and including development | Existing                           | PASS: 0 vulnerabilities in each                                                                                   |

Counts in migration/pooler rows are independent executions of the same 74 integration cases, not distinct new cases. The three new integration cases verify actual shared/exclusive lock modes, revocation waiting/denial and 40 concurrent tenant-isolated reads. Existing write-concurrency, idempotency, booking-conflict, authorization, audit and rollback cases remain intact.

## Failures retained, not hidden

The new shared-lock expectation failed against the original exclusive implementation (one failed, two passed). An initial test harness used Prisma queryRaw for PostgreSQL void-returning pg_sleep; it was corrected to executeRaw before valid measurements.

The first candidate full HTTP run exposed a new adapter defect: constructing a native Request from Next's proxied NextRequest caused a private-field brand-check failure and signup HTTP 500. The adapter now reconstructs from public Web API fields and forwards the body stream once. A unit regression uses a proxied native Request; the corrected full HTTP and production auth checks passed. No assertion timeout or production rate-limit policy was relaxed.

The subsequent full browser run passed 14 groups, then failed at `scripts/browser-calling.ts:192` (15s wait for the display to clear after skip). This is retained as a failed run, not classified as environmental from the timeout alone. An unchanged complete CI HTTP/browser rerun also passed HTTP, then passed one browser group and failed at `scripts/browser-invitations.ts:140` waiting 15s for the hydrated invitation form. No timeout or test was weakened. Both runs used the committed CI warm-up sequence and loopback bind. Server logs contain no P2028 or unsafe-runtime errors; the first contains two stream-write errors at teardown, the second none. The failing invitation GET returned HTTP 200 in 4.8s. These observations do not distinguish every cold-compilation, client/SSE or application cause. No browser PASS is claimed, and repeated retries to obtain green were stopped. Browser instability remains a release-blocking investigation; the baseline also had an intermittent hydration timeout.

## Overall recommendation

**REQUEST CHANGES / not ready for release:** application-level M1–M3 corrections and targeted regressions pass locally, but both complete browser attempts failed and operational trust/cutover gates remain unverified. The patch can be independently reviewed locally; publishing it requires owner approval.

## Release gates

**NOT TESTED:** real trusted-ingress overwriting/direct-backend denial, real TLS and SMTP transport, complete production-mode browser flows, provider-specific PostgreSQL roles/private networking/managed pooler, multi-instance/NAT capacity, production-scale load, actual artifact cutover/rollback and backup restore. Existing shared-NAT throttling remains; per-account abuse policy needs independent review.

The older PR #6 allowlist rejects Opportunity grants. The regression verifies this incompatibility without changing grants; it is not a successful old-binary rollback rehearsal. Exact migration history rejects unknown newer migrations. Coordinated compatible artifact/grant rollout and rollback must be reviewed before deployment.

**BLOCKED by approval:** remote push, hosted CI, cloud/staging work and deployment. Independent human security review remains a release requirement. Local test success does not authorize release.

## Contention measurements

Paired local ABBA benchmark, with no browser/scanner running concurrently: the exact baseline organization-access function versus the shared-lock function, using the **same current uncached ACL/RLS audits, pool size five and transaction budgets** in both arms. Two synthetic tenants, 40 reads, eight workers and 20ms injected PostgreSQL work per read; every unscoped result asserted its own tenant contact. This isolates the lock change, not whole-old-binary versus whole-new-binary throughput.

| Arm                     | Total ms | p50 ms | p95 ms | Maximum ms | Isolation failures |
| ----------------------- | -------- | ------ | ------ | ---------- | ------------------ |
| before-exclusive        | 605      | 111    | 141    | 170        | 0                  |
| after-shared            | 432      | 75     | 110    | 118        | 0                  |
| after-shared-repeat     | 366      | 66     | 94     | 106        | 0                  |
| before-exclusive-repeat | 547      | 101    | 118    | 129        | 0                  |

No timeouts occurred in those four measured arms. The shared-lock totals were 432/366ms versus exclusive 605/547ms. This small synthetic comparison supports overlapping reads; it is not an SLO, production capacity test or proof all timeout causes are fixed. Per-transaction catalog checks remain deliberately uncached; saturated writes or a constrained provider pool can still time out and must fail closed.

## Scanner coverage and triage

- **Semgrep CE 1.182.1: completed**, 603 configured rules from 594 official pinned files; 525 applicable rules across 167 files, approximately 100% parsed lines, **zero parser errors**. The two prior JSX partial parses are resolved by equivalent `&amp;` literals. Three files were skipped by default ignore rules; generated/dependency and ignored material was not scanned. Rules are pinned to `16b9e6d45f10649f6a531ec4838ed9924372c3bc`, internal scanning only, metrics/cloud upload disabled. CE is not exhaustive taint/dynamic verification.
- Semgrep produced **282 notices**, not a clean/no-alert result: 254 JSX internationalization INFO, 15 replaceAll compatibility WARNING, six props-spreading INFO, three insecure-request ERROR, two template-string INFO, one unused-assignment INFO and one stringify-keys WARNING. Severity labels are scanner labels, not confirmed exploit severity.
- Original HTTP alerts: `scripts/browser-invitations.ts:53` and `scripts/http-smoke.ts:79`, loopback Mailpit inbox requests for synthetic test verification. New HTTP alert: `scripts/test-auth-proxy.mjs:82`, loopback-only production fixture health probe. These are reviewed local-test HTTP exceptions, **not approved production transports**. No rule suppression, TLS bypass or code rewrite to hide the findings was introduced.
- New stringify warning at `scripts/test-auth-proxy.mjs:183`: JSON serialization emits sanitized failure location/status metadata to stderr; it is not an object key, signature, cache identity or hash. No stable-stringification dependency is warranted. Existing typed UI props spreading and localization/style notices remain reviewed maintenance items; lint/type-check/build passed. The pinned Node runtime and tested browser support replaceAll; those compatibility notices do not justify removing a supported API.
- **Trivy 0.76.1: PASS**, official previously retrieved, certificate-verified GHCR database cache; no network workaround or security disabling. Lockfile scan: 402 production records, **0 vulnerabilities**; including development: 805 records, **0 vulnerabilities**. This scan covers npm advisories, not container/OS images, IaC or runtime configuration. No database refresh was required for this same-day cache.
- **Gitleaks 8.30.1: PASS**, current tracked/untracked nonignored source snapshot, redacted output, no leaks. The baseline had separately scanned 15 reachable commits with no findings. The current branch introduces no historical commits before local preservation; source scanning does not attest external systems or secrets outside the scanned tree.
- No scanner installation was attempted or failed in this follow-up; existing reviewed tools were reused. Registry access is unnecessary because official rules/cache are local. No new third-party source or license was incorporated.

## Remaining remediation priorities

1. **Release-blocking verification:** independently review changed lock/auth/grant boundaries; approve and test an ingress that overwrites both private headers and blocks direct origin access; run hosted CI after push approval. Neither a secret header alone nor this local simulation proves the network trust boundary.
2. **Release-blocking operations:** approve provider role/TLS/pool budgets; rehearse coordinated compatible artifact/grant cutover and rollback plus restore. No real database grants were applied. The generated plan never repairs excess grants automatically.
3. **Before broader client load:** investigate any remaining display/browser timeout, exercise mixed reads/writes and multi-instance/NAT load at realistic volumes. Small synthetic shared-read gains do not eliminate pool starvation risk. Preserve fail-closed timeouts and do not cache privilege checks as a shortcut.
4. **Separate scoped Low follow-ups:** denial-event logging without sensitive data, additional conflicting state-transition/direct-RLS cases, production browser coverage, per-account abuse policy, strict version parsing, reflected error-message handling and production CSP/HSTS review. Existing service-level state-transition rules are not database constraints. These were not expanded into unrelated feature work here.

Environment: Node 24.19.0, npm 11.9.0, local Chromium 154.0.8037.57. Workflow YAML parsed (28 validation steps), captured CI shell passed bash syntax checking; actionlint was unavailable and was not installed. Hosted Chromium/version differences are not verified. Raw temporary server logs are deliberately excluded because they may contain synthetic private links.
