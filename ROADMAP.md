# Persistent implementation roadmap

Commercial client-delivery target supplied in Issue #1: **26 November 2026**. This foundation milestone does not establish complete commercial delivery readiness.

## Milestone 1 — identity and organization foundation

- [x] Inspect original checkout: README only, no existing product source or license grant.
- [x] Review dependency licenses; exact pins and lockfile.
- [x] Next.js / TypeScript / Tailwind / reusable shadcn-style UI primitives.
- [x] PostgreSQL schema and versioned initial migration.
- [x] Better Auth signup, email verification, password sign-in, database sessions, sign-out and recovery UI.
- [x] Organization creation, workspace switching, settings, membership roles and removal.
- [x] Hashed, expiring, single-use invitations, verified recipient matching and revocation.
- [x] Transactional audit records, role checks and last-owner concurrency control.
- [x] Real database integration tests and authenticated HTTP Server Action smoke checks.
- [x] Real CRM client workflow: intake → qualification → customer conversion, archive, audit and tenant isolation tests.
- [x] Deployment runbook without deployment.
- [x] Architecture, engineering instructions, source/license audit, security policy and environment examples.
- [x] Reconcile the Issue #1 text supplied by the user; direct API retrieval remains blocked.
- [ ] Push reviewed branch and open PR with verified evidence (Git access and API authorization verified separately).

## Next production task — harden identity and onboarding

Before public onboarding: configure verified sending domain and production SMTP; decide public signup versus invitation-only onboarding; add verified-email resend UI, MFA and a session-management screen; protect SMTP/account flows with delivery abuse controls; configure trusted ingress IP forwarding and test rate limits across multiple instances. Exercise full browser accessibility, mobile layouts, recovery, and invitation flows in CI. Resolve the documented development-tool advisory when upstream releases a compatible fix.

## Milestone 2 — tenant data defenses and operational readiness

- Separate migration and least-privilege runtime roles; introduce PostgreSQL RLS and tests for a non-bypass runtime role.
- Add composite tenant foreign keys to the first business models, schema-level invariants, and isolation checks for nested operations.
- Backup/restore drills, PITR, migration rollback planning and staged release procedures.
- Nonce-based CSP, HTTPS ingress/HSTS, secrets rotation, dependency update automation, account lifecycle and audit retention/export policies.
- Durable mail outbox, invitation email delivery, rate limits/quotas for organization actions and tracing with safe request identifiers.
- Deployment remains a separate, explicitly approved task.

## Milestone 3 — CRM and durable workflow core

Extend the implemented CRM contact workflow with accounts, consent provenance, richer client onboarding and task ownership. Preserve the current tenant keys, audit events and negative isolation tests. Add an outbox/worker and idempotent job runner before workflow side effects. Choose a representative industry package only when its actual requirements are defined.

## Milestone 4 — ATMA and agents

Provider abstraction, tenant policy, retrieval boundaries, cost limits, evaluations, tool authorization, approval checkpoints and run audit. No autonomous external business action until scoped permissions and reliable execution controls exist.

## Continuity rules

Replace checkboxes only with verifiable evidence. Update `docs/VALIDATION.md` for each milestone. Separate implemented, planned, blocked and production-unapproved capabilities. Do not turn outstanding operations into placeholder success UI.
