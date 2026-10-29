# Persistent implementation roadmap

## CRM opportunities — feat/crm-opportunities

Contact-linked opportunity capture, exact estimated INR value, OPEN/PROPOSAL/WON/LOST lifecycle, replay-safe creation, versioned stage mutations, search and paginated directory are implemented using existing BBD auth/tenancy/UI/audit. See docs/OPPORTUNITIES.md for source-access facts, actual tests and limitations. No external integration, merge or deployment is authorized; independent human review remains required. Appointment reminders are next only after this slice is preserved/reviewed.

## Doctor working hours — feat/clinic-doctor-schedules

Implemented weekly doctor hours, optional daily break, full-day leave and appointment duration with versioned/audited saves on the existing tenant-protected Doctor model. Shared rules govern slot suggestions, booking and rescheduling; conflicting active appointments are preserved. Exact validation and limits are in docs/DOCTOR_SCHEDULES.md. Independent human review and deployment approval remain required.

After review, implementation priority is CRM opportunities → consent-aware appointment reminders → WhatsApp booking → voice receptionist. External adapters require approved provider/data/spending controls before activation; no unlicensed workflow source is copied.

## Appointment slot suggestions — feat/clinic-slot-suggestions

The existing booking card gains authenticated, tenant-scoped conflict-free slot suggestions using Doctor resource labels and staff-selected windows, without new dependencies or migrations. Existing booking actions recheck permissions and conflicts under the organization lock; suggestions do not reserve a time or establish doctor working hours. See docs/SLOT_SUGGESTIONS.md and docs/SLOT_SUGGESTIONS_VALIDATION.md for behavior, actual validation and remaining review gates. Independent human security review remains required; no merge or deployment is authorized.

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
- [x] Commit and push `feat/issue-1-production-foundation` to the existing origin.
- [ ] Open PR: both GraphQL and REST API creation attempts returned Forbidden. PR text is ready in `docs/PR_DESCRIPTION.md`; GitHub provided a manual creation link.

## Next production task — harden identity and onboarding

Before public onboarding: configure verified sending domain and production SMTP; decide public signup versus invitation-only onboarding; add verified-email resend UI, MFA and a session-management screen; protect SMTP/account flows with delivery abuse controls; configure trusted ingress IP forwarding and test rate limits across multiple instances. Exercise full browser accessibility, mobile layouts, recovery, and invitation flows in CI. Resolve the documented development-tool advisory when upstream releases a compatible fix.

## Milestone 2 — tenant data defenses and operational readiness

- [x] Implement separate runtime/migration connections, FORCE RLS and tests under a non-bypass runtime role; verify fresh migrations under a non-superuser owner. Independent review and staging/pooler validation remain required.
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

## Tenant-isolation assignment

Implementation continues on `security/tenant-rls-hardening` in PR #3; see `docs/PR3_REVIEW_FOLLOWUP.md` for review corrections and exact validation evidence. Independent review of the final changes is still required. After that review accepts the boundary, recommend a scoped CRM opportunities/pipeline issue with tenant-aware parent keys and the same negative tests. No further CRM feature work is included in this security branch.

PR #3 exists: https://github.com/bloomdigital369-hue/BBD-MASTER-ATMA-OS/pull/3 . Git access verifies its head; API access for metadata/CI and body updates remains independently checked and reported in the follow-up. No merge or deployment is authorized.

## Clinic CRM Phase 1 — feat/clinic-crm-mvp

- [x] Clinic lead creation, editing, source/status tracking, search and paginated directory.
- [x] Appointment booking/rescheduling, resource/lead overlap protection and status lifecycle.
- [x] Due/overdue follow-ups, editing, completion/cancellation and live dashboard counts.
- [x] Three additional FORCE-RLS tables, composite tenant child keys, least-privilege runtime grants, synthetic security/workflow fixtures and HTTP/browser coverage.
- [ ] Independent review of the new migration, grants and clinic workflows; staging/provider validation before real use.
- [ ] Practitioner/room directory, configurable clinic timezone/hours, richer staff roles, consent/retention policy and larger agenda/task pagination.
- [ ] Durable reminder outbox and provider delivery only after consent, retry/idempotency and approvals are designed. No messages are sent in Phase 1.

Exact commands, results, initial failures and remaining scope are in docs/CLINIC_PHASE1_VALIDATION.md. PR #3 is not merged; main and deployments remain outside this milestone.

## Human-supervised development automation — 28 October 2026

- [x] Audit/reuse the existing validation workflow, security guidance, source boundaries and test runners.
- [x] Prepare task-branch CI hardening, PR evidence template and optional independent-review handoff without new dependencies or provider integrations.
- [ ] Owner configures/validates repository rules, required hosted checks, Actions budget and independent review access. No cloud staging or production deployment is authorized.

See docs/DEVELOPMENT_AUTOMATION.md and docs/AUTOMATION_VALIDATION.md for permissions, cost boundaries and exact local validation. Automated issue-to-agent scheduling is not implemented.

## PR #4 security follow-up

- [x] Replace permissive runtime grant accumulation with a shared effective-privilege audit and fail-closed, transactional allowlist provisioning; preserve existing roles and drift for explicit review.
- [x] Add isolated PostgreSQL privilege-drift regressions and an explicit CI check. See docs/PR4_PRIVILEGE_DRIFT_VALIDATION.md for actual evidence and limits.
- [ ] Paginate appointment agendas and follow-ups beyond the current 100-record limit, preserving deterministic ordering, filters and tenant isolation. Add greater-than-100-record tests proving every permitted record remains reachable. Lead-detail histories also need pagination beyond 50 records. This is a future clinic development task, not included in the security fix.
- [ ] Independent human review of SQL/privilege enforcement, RLS, authentication and clinic migration remains required before merge. Production/cloud staging approval gates are unchanged.

## Clinic CRM + Doctor Calling Display — feat/clinic-doctor-calling

Implemented scope and validation: docs/DOCTOR_CALLING.md and docs/DOCTOR_CALLING_VALIDATION.md. Foundation parent is 9370de3; PR #4 remains Draft for independent human security review.

- Administrative patient registration linked to existing leads; walk-in and appointment-to-token issuance.
- Stable doctor/room queues; audited daily token allocation, call/recall/skip/complete/cancel and appointment synchronization.
- Authenticated near-real-time SSE and a patient-identity-free display with DISPLAY-only permissions.
- Patient/reception pagination, tenant/RLS constraints, negative/concurrency regressions and browser transport coverage.
- Next: independent review, the existing >100 appointment-picker/agenda/follow-up limits, doctor archiving/rosters and granular staff assignment, device/session controls, consent/retention, accessibility and multi-instance load/proxy tests. Deployment remains separately approval-gated.
