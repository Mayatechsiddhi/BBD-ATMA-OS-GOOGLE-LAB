# PR #3 security-review follow-up

Scope: continue `security/tenant-rls-hardening`; no main changes, merges, deployment, production credentials or database resets. Starting head: `df3b945c12b8451e1f275d84c81f80273d534856`. Native Git retrieval of PR #3's merge ref confirmed parents `e8850236bf4dd801f4706ba5b4a6727c5353d143` (foundation base) and that security head. The working tree was initially clean.

## Findings and corrections

1. **High: pre-hydration authentication forms could submit credentials through GET.** A real browser run exposed a sign-in URL containing disposable fixture credentials when the client handler was not ready. Authentication and password-recovery forms now explicitly use POST and disable submission until hydration. The browser check examines all four unhydrated form variants and verifies normal browser sign-in. Affected local fixture identities were removed; no production identity was involved.
2. **Medium: native invitation POST could stall during SSR retries.** Profiling the reproduced request showed repeated InviteForm initialization and garbage collection around action binding/signature matching. Binding a new action during render was replaced with a stable canonical Server Action reference. The tenant ID is an untrusted hidden resource selector, never an actor identity; requireSession and transactional membership authorization remain mandatory. Native HTTP invitation creation now reads the complete response within the existing 20-second deadline. The browser tests creation, repeated submission and persistence; the HTTP test no longer substitutes a domain-service call for invitation creation.
3. **Medium: native browser POST rejected because Origin was null.** Chromium's native form request under no-referrer was rejected by Next's CSRF check. Referrer-Policy now uses same-origin, preserving same-origin POST Origin and suppressing cross-origin referrers. Origin/CSRF checks were not disabled; the HTTP foreign-origin attack still fails.
4. **Medium: development argument traces could expose previous invitation state.** Next's default Server Function trace printed the previous invitation token on another submission. Argument tracing and browser-to-terminal forwarding are disabled, while structured application logging and HTTP diagnostics remain. The browser workflow checks its fixture passwords, verification URLs and issued tokens against the server log. Fixture tokens from diagnostic attempts are unusable after fixture cleanup; they are not committed.
5. **Evidence gap closed locally: migration login and external pooling.** The migration runner now connects using a separate restricted LOGIN, verifies current_user = session_user and non-superuser/non-bypass flags, applies/repeats migrations, verifies object ownership, then reruns the integration suite under the runtime login. It preserves the previous NOLOGIN test database and existing passwords. The pooler runner executes the integration suite through actual PgBouncer 1.26.1 transaction pooling with SCRAM, one server connection and prepared-statement tracking. Fixture administration remains a separate direct connection.

## Executed checks

| Check                               | Result                                                                                                                                       |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Lint / typecheck / production build | Passed                                                                                                                                       |
| Unit suite                          | 43 passed                                                                                                                                    |
| Direct PostgreSQL integration suite | 34 passed with populated, generated A/B fixtures and restricted runtime credentials                                                          |
| Authenticated migration login       | Fresh four-migration chain applied on first run; subsequent applications had no pending migrations; all 34 integration cases passed          |
| PgBouncer transaction pooling       | Same 34 integration cases passed through the pinned local pooler                                                                             |
| Native HTTP suite                   | Passed, including actual invitation creation, foreign-session invitation denial, protected pages/actions, CRM persistence and CSRF rejection |
| Chromium browser workflow           | Passed: eight check groups described below; Chromium 154.0.8037.57 / Playwright Core 1.64.1                                                  |
| Production dependency audit         | 0 reported vulnerabilities                                                                                                                   |
| Full dependency audit               | Nonzero: 6 existing high development dependency paths through braces; not described as clean                                                 |
| License inventory                   | 819 locked packages; no missing declarations; one reviewed development dependency added                                                      |

The 34 integration cases are the same cases repeated across direct, migration-login and pooler runs, not 102 unique tests. They exercise omitted predicates, nested reads, search/count/export-shaped aggregation, known foreign IDs, unauthorized updates/deletes, tenant reparenting, role restrictions, invitation proofs, audit immutability, commit/rollback context cleanup, stale session settings and concurrent transactions. Actual search/export application endpoints do not exist and are not claimed tested.

Browser check groups: hydrated invitation creation and private fragment link; other-tenant replay of the actual captured request without persistence; correctly framed forged OWNER payload rejection; repeated submission producing a new link; wrong-recipient denial/matching-recipient acceptance/single-use replay and atomic membership audit; unhydrated auth/recovery POST-only disabled forms; native no-JavaScript invitation creation using an existing authenticated session; server-log secret exclusion. Browser assertions wait for UI state and persisted rows with deadlines. Development RSC debug streams can remain open after UI completion; browser network-stream closure is **not** claimed verified. The separate native HTTP test verifies full response completion.

## Reproduction

Use existing local `.env`, PostgreSQL and Mailpit; never copy these credentials to production. See README for preparation. Run lint, typecheck, unit, integration, migration, pooler and build commands, then start `npm run dev` separately with output redirected to a private local log. Run:

```sh
npm run test:http
BROWSER_SERVER_LOG=/tmp/bbd-next.log npm run test:browser
```

The log path must be the actual current server log. CHROMIUM_PATH overrides the installed browser executable. No test saves browser storage, screenshots, request bodies or mailbox messages into the repository. Cleanup removes only generated fixture identities/organizations. The temporary PgBouncer container and its credential files are removed; existing databases and volumes remain. The migration test keeps its dedicated database and ignored mode-0600 `.env.migration-test` for repeatability.

## Failures and limits retained

- Original and intermediate invitation failures were reproduced, not counted as passes. A test-harness attempt to await development RSC stream closure was replaced with bounded UI/persistence assertions, while preserving an independent full-body native HTTP check. Forged request tests recompute HTTP framing and wait for actual UI state changes rather than reading an old invitation link.
- Turbopack development repeatedly reloaded the sign-in page in this environment. Development/CI now explicitly use Next's supported webpack option; production build still uses the unchanged build command. This is a compatibility choice, not a claim that the upstream Turbopack behavior was repaired.
- Local browser attempts against the production build did not complete email verification: production HTTPS/SMTP/STARTTLS requirements rejected the development mail configuration. No TLS-verification bypass or production credential was introduced. Passing browser evidence is against the local development server; production runtime/SMTP verification remains a staging gate.
- PgBouncer evidence covers this exact local transaction-mode configuration. Managed-provider authentication, TLS, failover, load and transaction timeouts remain untested. Statement pooling is unsupported. No claim is made of production readiness or comprehensive security certification.
- Migration execution used the existing pinned Prisma WASM helper. The native CLI and a provider-specific release migration job need separate staging validation.
- RLS still trusts server-supplied actor context. SQL injection/stolen runtime credentials can forge it; migration owners and global auth records remain privileged boundaries. Existing last-owner/workflow invariants still depend on service authorization/locking.
- Browser evidence covers Chromium, not accessibility or other engines. Container OS vulnerability scanning and deployment backup/restore remain separate work. The existing development dependency advisory remains open.
- GitHub GraphQL and REST reads return Forbidden, so current remote CI status is unverified. `gh pr edit 3 --body-file docs/TENANT_ISOLATION_PR.md` also returned Forbidden; no successful body update is claimed. The exact replacement body is committed for review. Security-branch push/readback outcomes are reported in the handoff. No automatic merge or deployment is permitted.

After independent review accepts these changes, the next scoped product issue should implement tenant-owned CRM opportunities/pipeline stages with composite tenant foreign keys, explicit transition permissions, audit events and the same isolation suites.
