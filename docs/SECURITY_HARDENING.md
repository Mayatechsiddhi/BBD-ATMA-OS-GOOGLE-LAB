# Audit Medium findings — local hardening and evidence

Branch: `security/audit-medium-hardening`, based on `fb9aa2c77622a4d9ad6f0c53d03018a6b3352f4d`. No push, merge or deployment is authorized. Baselines are the 29–30 October consolidated audit and the owner's condensed Claude PR #7/PR #6 static-review handoff. Claude ran no executable tests; its original full transcript was not supplied. No new dependency, provider API, application migration, customer data or production connection is introduced.

## M1 — contention and health

Reads and display snapshots use transaction-scoped **shared** organization advisory locks. Mutations, invitation acceptance, membership revocation and owner changes retain **exclusive** locks on the same key. Membership authorization happens after the lock is acquired, inside the transaction; both lock types last until commit/rollback. Existing uncached runtime-role, privilege and FORCE-RLS audits remain in **every** tenant transaction. Read callbacks must never be used to mutate data.

Prisma's existing acquisition/execution defaults are explicit: 2,000 / 5,000 ms. They were not increased. The PostgreSQL application pool defaults to five connections per process; `DATABASE_POOL_MAX` accepts only 1–20. Connection admission times out at 2,000 ms, idle connections at 10,000 ms. Plan the combined instance/pool budget before staging; five is a bounded default, not proof of adequate production capacity. There is no automatic retry of writes.

The anonymous `/api/health` now performs one `SELECT 1`, not catalog/ACL scans. It is **connectivity only**, not permission/migration readiness. Startup runs strict required/excess grant checks. The private read-only deployment preflight also checks exact migration history; no public deep-readiness endpoint was added. SSE retains per-snapshot session/membership revalidation and holds no transaction idle between snapshots.

`tests/integration/contention.test.ts` inspects real PostgreSQL lock modes, verifies membership revocation waits for an active reader and then denies further reads, and checks tenant isolation under 40 reads at concurrency eight. The original read-lock regression failed against baseline `ExclusiveLock`; the changed implementation must pass without test timeout changes. Existing concurrent booking, owner, stage, idempotency and rollback tests remain required.

## M2 — authenticated production client-IP contract

Production Better Auth selects **only `x-bbd-client-ip`**, never arbitrary XFF. The HTTP auth adapter requires one syntactically valid IPv4/IPv6 address and a matching server-side `x-bbd-auth-proxy-key`, compared with constant-size SHA-256 digests using `timingSafeEqual`. Missing/wrong keys, malformed or comma-separated IP assertions fail closed before Better Auth. The adapter strips the gateway key and untrusted forwarded-IP headers; request body, cookies, Origin and all existing auth/session/CSRF settings remain intact.

`AUTH_PROXY_SECRET` is mandatory at production startup: 32–128 printable non-space ASCII characters, generated randomly and held in secret storage. Generate at least 32 random bytes, not a human password. Never expose it to browser code, response headers, source, logs, agent prompts or screenshots. The `.env.example` placeholder is deliberately too short to pass validation.

**Gateway/operator requirements, not yet provisioned or verified:**

1. Select an approved authenticated ingress and prevent direct backend access.
2. Strip all incoming `x-bbd-client-ip` / `x-bbd-auth-proxy-key` values, overwrite them with the actual client address and server-side key, and protect the gateway-to-app hop. Do not merely append a client-provided header or forward a comma chain.
3. Use HTTPS, configured trusted origins, production cookies and an independently approved secret-rotation plan. Restrict logging of request headers and verification/reset URLs. Do not expose a development server.
4. Rehearse actual multi-hop spoofing, NAT, cookie/verification and pooler behavior in approved private staging before declaring ingress readiness. Cloud SQL/provider-specific role memberships and transports must pass the strict preflight without unreviewed permission exceptions. This patch adds no gateway, cloud resources or key to an external system.

Only non-production **loopback-base** synthetic development retains XFF simulation; that setting is not proof a listening socket is private. `scripts/test-auth-proxy.mjs` launches the built production-mode app on loopback against an isolated test DB with only runtime credentials. Real HTTP checks reject forged gateway assertions, retain sign-in/sign-up throttling despite rotating untrusted IP headers, and distinguish independent attested clients. The key is never emitted. This is **not** real-ingress/TLS validation or a full production-mode browser/SMTP test.

Existing shared-NAT clients still share the existing 3-attempt/10-second auth rule. Per-account quotas, MFA, signup/delivery abuse controls and multi-instance rate-limit capacity are separate review gates, not silently changed policies.

## M3 — grants and migration readiness

The authoritative `runtimeTables` / `runtimeFunctions` allowlist now provides:

- The existing uncached excess/effective-ACL audit, unchanged and still fail-closed.
- A separate required-grant/schema check for missing relation/schema USAGE, table privileges, mutable columns and private helper EXECUTE rights. Startup fails when the contract is incomplete. Runtime retains no migration-history access.
- Additive, operator-reviewed grant SQL generation with explicit role quoting, no role creation/passwords, ownership changes, blanket REVOKE, default/PUBLIC grants or grant options.

Generate a **review-only** plan without connecting to a database:

```sh
npm run --silent db:grants:plan -- bbd_runtime > /tmp/bbd-runtime-grants.review.sql
```

Do not execute it automatically. Apply committed migrations first under the separately reviewed migration owner. Reject existing unsafe privileges/ownership before considering new grants. Missing allowlisted grants can be filled; excess privileges require a separately approved investigation. Review and approve the resulting grant/artifact cutover explicitly.

Read-only preflight after migration / reviewed grants:

```sh
npm run --silent db:readiness
```

Set `RUNTIME_DATABASE_URL` to the restricted login and `MIGRATION_AUDIT_DATABASE_URL` to a **separate metadata-reader connection**, with SELECT on `_prisma_migrations`. Never inject that metadata credential or migration credentials into the application process. The preflight requires the same endpoint/database for both logins and certificate-verified PostgreSQL TLS (`sslmode=verify-full`) outside localhost; provider-specific proxy/certificate constraints still need review. Both transactions are read-only. The public health check is not a substitute.

Preflight rejects missing/excess grants, unsafe roles/RLS, missing/unfinished/edited/duplicate migration history and unknown newer applied migrations. It prints only schema/permission/migration metadata, never credentials or application rows. It does not attest every possible schema mutation or perform rollback. `scripts/check-env.ts` validates strict runtime grants without needing migration credentials.

### Compatibility and rollback

The PR #6 → PR #7 runtime contracts remain intentionally incompatible: older artifacts reject new Opportunity grants. A regression executes the prior allowlist against the isolated current-role fixture and verifies rejection **without modifying its grants**. Migration-history checks reject newer unknown migrations for an older manifest. Do not mislabel additive DDL as rolling compatibility or remove grants under a running newer artifact to force rollback.

Rehearse a coordinated no-mixed-artifact cutover and a reviewed compatible artifact rollback before deployment approval. Stop/drain incompatible traffic, preserve data and migration history, and verify the selected artifact's full readiness. No production restore, destructive down migration or safe zero-downtime rollback is claimed here. A provider backup/restore drill remains required.

`npm run test:migrations:fresh` creates a fresh uniquely named local test DB under a non-superuser/non-bypass owner, applies migrations twice, runs preflight and integration tests, and retains that synthetic fixture for inspection. Default `test:migrations` preserves/reuses the earlier dedicated fixture. Neither resets existing DBs. The grant tests mutate only their newly generated fixture role/database and verify missing SELECT/helper grants and schema mismatch; shared runtime roles are never revoked/altered.

## Semgrep review

The two original `react-insecure-request` flags are local-only Mailpit inbox requests in browser/HTTP test scripts, not production transports. Mailpit stays bound to loopback, test runners retain local URL guards, and no TLS bypass/suppression was introduced. This review does not turn HTTP into an approved production email path.

The two JSX literal ampersands are now written as `&amp;`. Browser-visible labels remain “People & access” / “Manage people & access →”; authorization is unchanged. Re-run the pinned local CE rules to verify parse coverage, and retain any remaining scanner limitations instead of changing rules to hide findings. Existing standard typed shadcn-style props spreading and localization notices are not automatically vulnerabilities.

## Validation and before/after results

Final command counts, isolated load measurements, retained failures and remaining limitations are recorded in `SECURITY_HARDENING_VALIDATION.md`. Both complete development browser attempts failed at different UI waits; no full browser pass or environmental explanation is claimed. Baseline audit had 117 unit, 22 privilege and 71 integration tests, 16 browser PASS groups on rerun, and intermittent transaction/hydration failures. Those retries did not establish a fix.

Production deployment remains **not approved / not verified**: actual ingress, private-network/TLS/provider pooler configuration, coordinated cutover/rollback, backups, real SMTP and independent release review are outstanding. No push or hosted CI run is performed for this branch without approval.
