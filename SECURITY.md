# Security boundaries and outstanding controls

Report suspected vulnerabilities privately to repository owners. Do not disclose secrets or customer records in GitHub issues. No security contact address was supplied; owners must establish one before public launch.

## Implemented

- Better Auth password hashing, mandatory verified email, signed HttpOnly sessions, secure cookies in production, explicit CSRF and origin checks, database auth rate limits, seven-day session lifetime and reset-time session revocation.
- PostgreSQL FORCE RLS, a non-owner runtime role, transaction-local actor/tenant context bound to the current transaction ID, fail-closed runtime checks and append-only runtime audit grants protect against omitted ORM predicates and pool reuse. The migration owner and global authentication subsystem remain trusted. See docs/TENANT_ISOLATION.md.
- Every tenant read/write checks current membership; owners alone manage roles/removal. Concurrent last-owner changes serialize using PostgreSQL transaction advisory locks.
- Invitation tokens use 256 random bits, SHA-256 storage, expiry, email matching and atomic single-use consumption. Private invite links use URL fragments so tokens do not enter server request logs. Auth recovery/verification paths are excluded from development request logging.
- Zod validation, ORM parameterization, no submitted data or secrets in application logs, generic client-facing failures, authenticated member directory, and atomic audit writes.
- Next.js action CSRF/body-size defenses and browser headers (nosniff, DENY framing, same-origin referrer policy, restrictive permissions and baseline CSP). Native same-origin POSTs retain Origin for CSRF validation; cross-origin navigation sends no referrer.
- Client-only authentication/recovery forms explicitly use POST and disable submission until hydration, preventing native GET credential leakage before event handlers are ready. Next development argument traces and browser-to-terminal forwarding are disabled; the browser regression checks local server logs for fixture secrets.

## Audit follow-up

Production auth HTTP rejects unverified client-IP assertions: a trusted gateway must overwrite x-bbd-client-ip and x-bbd-auth-proxy-key, use a random AUTH_PROXY_SECRET from secret storage, strip client-supplied versions and prevent direct backend access. The key is consumed before Better Auth; XFF is not selected outside local synthetic development. Real ingress remains unverified until an approved staging exercise. Shared-NAT clients retain the existing per-IP limit; no account-limit/MFA policy is claimed.

Read/display advisory locks are shared, mutations/access changes exclusive, and membership is checked after locking. Transaction privilege/RLS audits remain uncached. Public health is connectivity-only; startup/private preflight verifies required as well as excessive grants. See docs/SECURITY_HARDENING.md for exact scope, negative tests and release limits.

## Production gates

This milestone is production-oriented application code, not a declaration of operational production readiness. No deployment was performed.

1. Configure HTTPS and trusted reverse proxy header sanitation. Do not expose an ingress that lets callers forge the client IP used by auth rate limits. Implement distributed action/mail abuse controls.
2. Set strong unique secrets, PostgreSQL TLS, least-privilege runtime credentials, production SMTP with TLS/authentication and verified sending domain. Mailpit is local only.
3. Decide signup policy and add MFA, session inventory/revocation, account lifecycle, verified-email resend and recovery abuse tests.
4. Review and provision the separate runtime/migration roles and RLS in staging before any release; verify the actual deployment pooler, backup/restore, retention and tamper-resistant audit export. RLS does not make forged server actor context or global auth credentials safe after arbitrary application SQL execution.
5. Replace the current inline-compatible CSP with tested nonces, and add ingress HSTS after HTTPS validation.
6. Run real browser, accessibility, multi-instance rate-limit and dependency security checks before launch. Bound invitation/action volumes and add a durable mail outbox before scale.

## Dependency advisory status

The 30 October audit of this unchanged dependency lockfile reported zero known vulnerabilities in both production and full npm audits, and zero Trivy matches across 805 package records. These are dated advisory snapshots, not proof of supply-chain safety. The notes below describe historical findings; they are not a claim that the old advisory remains active today.

Clinic Phase 1 rechecks the registry rather than relying on the earlier foundation snapshot. fast-uri 3.1.8 had URI-normalization advisories; its reviewed, range-compatible 3.1.9 leaf patch is locked. See docs/CLINIC_PHASE1_VALIDATION.md for current production/full audit results. Audit output is a dated advisory snapshot, not a security certification.

Historical foundation review:

The reviewed Prisma 6 dependency chain had an advisory in deepmerge-ts; Prisma 7.10.1 resolves it. The current Next.js ESLint and Prisma development tooling depend on braces <=3.0.3, reported as GHSA-vfj7-8cjw-p6xm (deeply nested glob-pattern stack exhaustion). The registry has no patched braces release at the time of this milestone. Inputs here are repository-maintained development patterns; this is not a public application endpoint. Do not process untrusted patterns with these tools. `npm audit` reports high-severity development dependency paths; do not describe the full dependency tree as vulnerability-free. Record exact audit results in validation evidence and track an upstream compatible fix. Do not downgrade Next.js or disable checks to conceal the advisory.

## Clinic calling extension

Patient/doctor/token records use the existing tenant transaction and runtime privilege boundary, with eleven FORCE-RLS tables and composite tenant foreign keys. DISPLAY membership cannot read private patient, clinic, contact or audit rows. Its authenticated SSE payload projects token/doctor/room details only; sessions and membership are rechecked per snapshot, and client cards clear on transport loss/revocation/staleness. No anonymous display or provider key is added. Mutations/audit/revision updates are atomic, and cancelled-token history is retained. See docs/DOCTOR_CALLING.md for exact limits, device requirements and the coordinated grant/artifact rollout caveat. Human review, capacity/proxy/device validation and all prior production gates remain required.
