## Internal workforce contract harness

A separate process-local mock in src/modules/internal-workforce implements strict versioned synthetic task/result contracts, company/role/department checks, digest-bound approval, manual bounded retries, idempotency and a bounded audit ledger. It performs no model, transport, filesystem, shell or tenant-database operation and is not connected to customer-facing ATMA or the CRM outbox. No endpoint, migration or dependency is added. See docs/WORKFORCE_CONTRACT_HARNESS.md for validation and the unimplemented production/Paperclip boundary.

## Phase 2A — transactional tenant events

Opportunity creation now appends an immutable OutboxEvent in the existing CRM-entitled organization transaction with its audit. Replay-safe opportunity creation emits once. The event contract contains only an opaque opportunity reference, version, UUID, database timestamp and per-organization sequence. A bounded owner/admin internal pull interface validates envelopes; no delivery, checkpoint, provider, worker or public event API is activated. The protected inventory is fourteen tables. See docs/EVENT_FOUNDATION.md for ordering, consumer-idempotency and coordinated migration/grant rollback requirements.

## Phase 1 module control plane — 31 October 2026

The reviewed registry distinguishes available CRM/Clinic capabilities from planned modules. OrganizationModule persists per-organization flags and optimistic versions, extending the FORCE-RLS inventory to thirteen tables. CRM, clinic scheduling, appointments and calling services enforce both current membership and entitlement under the existing organization lock/transaction. OWNER-only access changes serialize with these operations and append an audit event atomically. Missing rows and unavailable modules deny access. This is tenant feature administration, not subscription billing or a platform superadmin. See docs/MODULE_ENTITLEMENTS.md for scope and additive migration/cutover limits; historical sections below describe earlier milestones.

# BBD Master ATMA OS architecture

CRM opportunities reuse Contact through a composite tenant foreign key and extend the protected inventory to twelve tables. Capture uses a tenant-scoped request UUID; stage mutations use optimistic versions inside the existing organization transaction/audit boundary. Existing CRM contacts and Clinic OS remain their current modules; no second identity, queue, scheduling or UI framework is added. See docs/OPPORTUNITIES.md for implemented scope.

Doctor scheduling extends the existing clinic/calling boundary with validated JSON and optimistic versioning on Doctor, reusing its FORCE RLS and transaction/audit controls. Shared hours/break/leave/duration rules constrain slot suggestions and new/rescheduled doctor-resource bookings. Hours/leave edits preserve active appointments by rejecting conflicts; no background scheduler or external service is added. See docs/DOCTOR_SCHEDULES.md for legacy-null behavior and exact limits.

## Foundation milestone

A Next.js App Router application using React, TypeScript, PostgreSQL, Prisma's PostgreSQL driver adapter, Better Auth, Tailwind CSS, and locally owned shadcn-style UI primitives using Radix Slot and class-variance-authority. No prior application source existed. No business metrics or AI operations are fabricated.

## Trust and request flow

1. Better Auth owns password hashing, email verification, password reset, opaque database sessions, cookie signing and auth rate limiting.
2. Next.js Server Components render authenticated data. Every page and every Server Action authenticates independently; layouts are not a security boundary.
3. Server Actions take only resource identifiers and validated input. Actor identity comes from the server session.
4. Organization and CRM services authorize database membership within a transaction. Transactions obtain shared PostgreSQL advisory locks for reads/display and exclusive locks for mutations and access changes, before fresh authorization, so revocation and last-owner guarantees remain serialized across instances.
5. Organization queries include tenant predicates. Nonmembers receive a generic 404 at page boundaries. A browser-supplied organization identifier grants no authority.
6. Mutations and audit events commit atomically. Role changes and sign-outs take effect on the next session/membership read; there is no cookie session cache.

The service's actorId parameter is trusted server context, not an API input. Importing the raw Prisma client in new tenant-facing routes bypasses this boundary and is prohibited. PostgreSQL FORCE RLS now protects Organization, Membership, Invitation, AuditEvent, Contact, ClinicLead, Appointment, FollowUp, Patient, Doctor, QueueToken, Opportunity and OrganizationModule under a separate unprivileged runtime role. `withActor` installs transaction-local actor/organization/invitation context and the current PostgreSQL transaction ID. RLS checks current membership and fails closed without that context. Runtime startup/health/transactions reject owner, elevated or incompletely migrated connections. The migration owner is explicitly privileged; narrow SECURITY DEFINER membership lookup/bootstrap functions run as that owner with fixed search paths and explicit grants. See `docs/TENANT_ISOLATION.md` for the threat model: arbitrary SQL execution with runtime credentials can forge the trusted actor context, so RLS is not authentication and does not contain a fully compromised application.

## Data model

- Global identity: User, Account, Session, Verification and RateLimit (Better Auth).
- Organization: independent tenant, immutable unique slug, editable name.
- Membership: unique (organizationId, userId), OWNER / ADMIN / MEMBER / DISPLAY.
- Invitation: tenant, normalized email, ADMIN / MEMBER / DISPLAY role, SHA-256 token hash, 48-hour expiry, single-use acceptance. Acceptance requires a verified matching email and cannot change an existing member's role.
- Contact: tenant-owned, unique normalized email per organization, composite (organizationId, id) key, LEAD → QUALIFIED → CUSTOMER; archive from any live state. Owners/administrators write; members read. Invalid state skips, duplicate transitions and foreign contact IDs are rejected.
- AuditEvent: immutable through application services; tenant ID, actor ID, action, optional subject and timestamp. The runtime role has SELECT/INSERT only, and INSERT requires the current actor and tenant. Migration credentials remain privileged; tamper-resistant archival is a later production control.

Organization creation and its initial OWNER membership are one transaction. All role and removal operations preserve an owner under concurrent requests. Global account deletion is intentionally not exposed.

## Authorization matrix

| Capability                                       | Owner | Administrator | Member | Nonmember |
| ------------------------------------------------ | ----- | ------------- | ------ | --------- |
| View tenant dashboard and member directory       | Yes   | Yes           | Yes    | No        |
| Update organization name                         | Yes   | Yes           | No     | No        |
| Create/revoke admin or member invitations        | Yes   | Yes           | No     | No        |
| View pending invitations                         | Yes   | Yes           | No     | No        |
| Capture, qualify, convert or archive CRM clients | Yes   | Yes           | No     | No        |
| Change roles, promote owner, remove member       | Yes   | No            | No     | No        |

There is no implicit platform-wide superadmin. A workspace dashboard is organization administration, never cross-tenant administration.

## Module boundaries

`src/modules/organizations` owns the identity/tenancy foundation. `src/modules/crm` implements the working client lifecycle. Both use the shared transactional organization access boundary in `organizations/access.ts`. `src/modules/registry.ts` now catalogs available CRM/Clinic and planned boundaries. Entitlements never implement a planned capability:

- ATMA: tenant context retrieval, model policy and inference audit.
- Agents: tool registry, scoped credentials, bounded execution and approval requirements.
- Workflows: durable jobs, idempotency, retries and outbox events.
- CRM expansion: accounts, relationship details and consent provenance beyond the implemented contact lifecycle.
- Marketing: approved audiences and consent-aware delivery providers.
- Industry systems: versioned domain packages composed from core capabilities; never fork the tenancy/auth layer.

Add future modules as `src/modules/<domain>/{validation,policy,service,...}` with explicit request/tenant context. Introduce queues and an outbox before background side effects. Provider keys belong to secret storage and never client bundles. Do not introduce tenant business tables without scoped uniqueness, foreign keys and isolation tests.

## Runtime and operations

PostgreSQL is the sole authoritative persistence layer. Local Docker Compose binds PostgreSQL and Mailpit to loopback; only the database has a persistent named volume. Mailpit is a local email test sink, never a production email provider. Development dependencies survive on disk; servers must restart after cloud restoration.

The default migration commands are Prisma CLI. A network-restricted fallback uses the exact same official Prisma WASM engine and migration history through pinned internal APIs; it is isolated in `scripts/prisma-wasm.mjs`, applies committed migrations only, and never resets a database. Revalidate it on every Prisma upgrade. npm integrity and database migration checksums remain enabled.

`/api/health` runs only a lightweight PostgreSQL connectivity query and exposes no credentials. Startup and the read-only deployment preflight check the complete required/excess runtime grant contract; tenant transactions retain uncached privilege/RLS checks. Production auth routes require a validated gateway credential and overwritten client-IP header; actual ingress verification remains a release gate. See docs/SECURITY_HARDENING.md. Structured application logging emits event names and error types, excluding submitted data and tokens. The CSP retains unsafe-inline for Next.js hydration; nonce-based CSP, HSTS at the HTTPS ingress, centralized tracing and alerting remain production hardening tasks.

## Clinic CRM — Phase 1

The organization-scoped clinic module lives in src/modules/clinic, with Server Actions in src/app/clinic-actions.ts and pages under /organizations/[organizationId]/clinic. It reuses authentication, membership permissions, transaction context, organization advisory locking, audit records and UI primitives. Existing general CRM Contact records remain unchanged; phone-first clinic enquiries use ClinicLead with optional email and no invented company address.

Appointment and FollowUp reference ClinicLead through (organizationId, leadId) → (organizationId, id), with scoped indexes and FORCE RLS. No runtime hard-delete or ownership-column update is granted. Owners/admins write; members read. Appointment intervals and follow-up completion consistency have database CHECK constraints. Allowed lifecycle transitions, future scheduling, lost-lead booking rules and overlap checks are service invariants inside the organization lock. Arbitrary privileged SQL is outside that scheduling guarantee.

Phase 1 assumes Asia/Kolkata for UI input/display, with timestamptz instants in PostgreSQL. A normalized free-text practitioner/resource label identifies one scheduling resource; a future practitioner/room directory must replace this before supporting richer scheduling. No clinical chart, diagnostic record, clinical-note field, reminder delivery, billing or patient self-service exists. See docs/CLINIC_CRM.md for exact behavior and bounds.

## Clinic calling extension

`src/modules/calling` reuses the clinic contact/appointment model and organization transaction/audit boundary. Patient references ClinicLead; Doctor supplies stable queue identity, room/resource and transactional revision; QueueToken binds patient/lead/optional appointment/doctor with composite tenant foreign keys and daily partial uniqueness. The protected inventory is now eleven tables. A DISPLAY membership can view only the non-identifying calling projection and is denied private clinical/contact/audit reads. Reception actions and the authenticated SSE route use the same authorization and database truth. See docs/DOCTOR_CALLING.md for transport, permissions, synchronization and rollout limits.
