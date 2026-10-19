# BBD Master ATMA OS architecture

## Foundation milestone

A Next.js App Router application using React, TypeScript, PostgreSQL, Prisma's PostgreSQL driver adapter, Better Auth, Tailwind CSS, and locally owned shadcn-style UI primitives using Radix Slot and class-variance-authority. No prior application source existed. No business metrics or AI operations are fabricated.

## Trust and request flow

1. Better Auth owns password hashing, email verification, password reset, opaque database sessions, cookie signing and auth rate limiting.
2. Next.js Server Components render authenticated data. Every page and every Server Action authenticates independently; layouts are not a security boundary.
3. Server Actions take only resource identifiers and validated input. Actor identity comes from the server session.
4. Organization and CRM services authorize database membership within a transaction. Transactions obtain a PostgreSQL advisory lock on the organization so membership revocations and last-owner checks serialize across instances.
5. Organization queries include tenant predicates. Nonmembers receive a generic 404 at page boundaries. A browser-supplied organization identifier grants no authority.
6. Mutations and audit events commit atomically. Role changes and sign-outs take effect on the next session/membership read; there is no cookie session cache.

The service's actorId parameter is trusted server context, not an API input. Importing the raw Prisma client in new tenant-facing routes bypasses this boundary and is prohibited. PostgreSQL RLS is not yet implemented; a database credential compromise bypasses service isolation. Separate migration and least-privilege runtime roles and add RLS as defense in depth before expanding to sensitive business records.

## Data model

- Global identity: User, Account, Session, Verification and RateLimit (Better Auth).
- Organization: independent tenant, immutable unique slug, editable name.
- Membership: unique (organizationId, userId), OWNER / ADMIN / MEMBER.
- Invitation: tenant, normalized email, ADMIN / MEMBER role, SHA-256 token hash, 48-hour expiry, single-use acceptance. Acceptance requires a verified matching email and cannot change an existing member's role.
- Contact: tenant-owned, unique normalized email per organization, composite (organizationId, id) key, LEAD → QUALIFIED → CUSTOMER; archive from any live state. Owners/administrators write; members read. Invalid state skips, duplicate transitions and foreign contact IDs are rejected.
- AuditEvent: immutable through application services; tenant ID, actor ID, action, optional subject and timestamp. The runtime database role currently remains capable of modification; tamper-resistant archival is a later production control.

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

`src/modules/organizations` owns the identity/tenancy foundation. `src/modules/crm` implements the working client lifecycle. Both use the shared transactional organization access boundary in `organizations/access.ts`. `src/modules/registry.ts` is a catalog of planned boundaries, not executable business functionality:

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

`/api/health` checks PostgreSQL and exposes no credentials. Structured application logging emits event names and error types, excluding submitted data and tokens. The CSP retains unsafe-inline for Next.js hydration; nonce-based CSP, HSTS at the HTTPS ingress, centralized tracing and alerting remain production hardening tasks.
