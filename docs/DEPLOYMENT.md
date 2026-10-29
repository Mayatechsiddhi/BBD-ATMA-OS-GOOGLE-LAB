# Current deployment security contract

Read [SECURITY_HARDENING.md](SECURITY_HARDENING.md) before the historical runbook below. Production now requires an authenticated client-IP gateway contract (`AUTH_PROXY_SECRET`), bounded per-process pools, strict required/excess runtime grants at startup, and a separate read-only migration-history preflight. Generate reviewed additive SQL with `npm run --silent db:grants:plan -- <runtime_role>`; no command here executes it against production. `db:runtime:local` remains local-only. The public `/api/health` is connectivity-only and must not be used as a schema/grant readiness attestation.

No rollout, billing, public exposure or production credential use is approved. Older artifacts cannot safely overlap new grant contracts; rehearse coordinated cutover/rollback first. Tests of the simulated production gateway do not verify a real edge or production browser/SMTP flow.

# Deployment runbook — review before execution

This is an operational handoff, not evidence of a deployment. No production system has been accessed. A deployment requires explicit owner approval and completion of SECURITY.md gates.

## Required infrastructure and configuration

- A supported Node.js 24 runtime (or 22.12+ in the 22.x line), Linux process supervisor, TLS-terminating ingress and private PostgreSQL endpoint.
- Separate PostgreSQL migration and least-privilege runtime credentials. Require verified database TLS with the provider's trusted CA; never set rejectUnauthorized=false or accept invalid certificates.
- A database backup and tested restore, staging database, production SMTP provider with authenticated TLS and a verified sending domain, secret storage and log collection.
- Runtime RUNTIME_DATABASE_URL (non-owner, NOSUPERUSER/NOBYPASSRLS with no elevated/owner role membership), BETTER_AUTH_SECRET (at least 32 random bytes), BETTER_AUTH_URL (the single canonical HTTPS origin), SMTP_HOST, SMTP_PORT, SMTP_FROM, SMTP_USER, SMTP_PASSWORD and optional LOG_LEVEL. Never use .env.example values or local Mailpit. TEST_DATABASE_URL and POSTGRES_PASSWORD are local development concerns.
- Sanitize and overwrite client IP/forwarded host headers at the trusted ingress. Do not broaden trusted origins to arbitrary customer domains. Use HSTS only after the HTTPS deployment is confirmed.

## Release procedure

1. Review the pull request, exact lockfile, license inventory, open dependency advisory and CI results. Produce an artifact SBOM, preserve bundled notices, scan the production/container OS dependencies and satisfy LGPL/MPL redistribution requirements where applicable.
2. On a trusted build machine, run `npm ci --ignore-scripts`, `npm rebuild esbuild`, `npm run db:generate`, lint, type-check, unit/integration/HTTP checks in staging, and `npm run build`. Prisma's official engine host must be reachable. The pinned WASM helper is a tested development fallback; revalidate it on upgrades and obtain release review before adopting internal APIs in the production release process.
3. Package the application, public assets if present, .next output, generated Prisma client and required production runtime dependencies. Do not package .env, tests' mailbox contents, local Docker volumes or credentials. The application uses the ordinary Next.js Node server; no platform-specific managed service is assumed.
4. Before migration, take a verified backup and review the committed SQL against staging and actual schema. Inject DATABASE_URL only into the approved migration job, then run `npm run db:migrate`. Do not run migrate dev, db push, resets or volume-removal commands in production. The two committed migrations are additive; no down migration is promised.
   Provision reviewed grants from docs/TENANT_ISOLATION.md after migration. Do not execute the local-only role provisioning helper against production.

5. Inject only runtime secrets into the application process and launch `npm start` under supervision. The start precheck requires production HTTPS and SMTP authentication. The start script uses the runtime tsx dependency for validation; retain production runtime dependencies and do not omit the precheck.
6. Confirm the internal `/api/health` response, HTTPS/security headers, verification/reset delivery, secure HttpOnly cookie behavior, logout, multi-tenant isolation and a real approved lead → qualified → customer record in staging before exposing production traffic. Limit public health access if required by the platform.
7. Roll out gradually, monitor auth errors, SMTP failures, tenant denials and database saturation. Preserve audit retention and incident-response access controls.

## Rollback and recovery

Stop traffic to the new release and restore the previously approved application artifact if necessary. Do not delete schemas or reverse migrations ad hoc. If a schema or data rollback is necessary, execute a reviewed backup/restore plan and reconcile changes written since backup. Test this procedure before the client-delivery deadline of 26 November 2026.

## Remaining release gates

MFA/session management, signup policy, durable email/outbox handling, staging verification of runtime grants/RLS and the actual pooler, browser/accessibility validation, nonce CSP and multi-instance abuse controls remain tracked in ROADMAP.md. The development tool braces advisory has no compatible upstream fix in the reviewed registry snapshot. These gates need explicit resolution or accepted release decisions; this foundation alone is not a production readiness signoff.
