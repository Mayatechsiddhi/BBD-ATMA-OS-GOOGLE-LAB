# Foundation verification and tenant-isolation audit

Baseline: `e8850236bf4dd801f4706ba5b4a6727c5353d143` on `feat/issue-1-production-foundation`. Work continues on `security/tenant-rls-hardening`, with no new repository or product redesign. This is a scoped engineering review and executed regression suite, not a third-party security certification or production readiness approval.

## What exists and what was checked

The existing npm/Next.js/TypeScript application has real PostgreSQL/Prisma persistence, Better Auth verified-email signup/password recovery/database sessions, organization creation/switching/settings, member roles/removal, expiring invitations, audit events, an administration shell and a real lead → qualified → customer → archived contact lifecycle. ATMA, agents, orchestration and industry packages are still planned. No deployed production system or credential was used.

Reviewed: commit history and remote refs, architecture and instructions, exact package/lockfile, Prisma models and all existing migration SQL, auth/session configuration, policy and service code, every API route and Server Action, and CI. No application search/export endpoint or contact hard-delete endpoint exists. Those are recorded as absent rather than claimed tested HTTP features.

## Baseline evidence and findings

The actual original runtime connection was `bbd` with SUPERUSER, BYPASSRLS, CREATEDB and CREATEROLE. All five tenant tables had RLS and FORCE RLS disabled. Existing service predicates and the 19 integration tests prevented the exercised API/service cross-tenant requests, but those tests used the same privileged client for services and fixture inspection. Deliberately unscoped queries with that connection can read both tenants; RLS cannot protect a superuser.

| Finding                                                                    | Correction                                                                                                                                                                                                               |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Privileged migration credentials used by application                       | Required separate RUNTIME_DATABASE_URL; no fallback. Runtime guard rejects elevated roles, any role membership, owner reachability, schema CREATE, missing FORCE RLS or incomplete transaction-context migration.        |
| No database tenant boundary when an ORM predicate is omitted               | FORCE RLS on all current tenant-owned tables, actor/membership/role-aware policies and tenant WITH CHECK constraints.                                                                                                    |
| Audit records writable/deletable by runtime credentials                    | Runtime SELECT/INSERT only; append requires matching actor and tenant. Migration owner remains privileged.                                                                                                               |
| Global identity deletion could cascade memberships across tenants          | User DELETE not granted to runtime; Better Auth account deletion explicitly disabled (not an implemented product feature).                                                                                               |
| No transaction-scoped database identity/tenant context                     | One Prisma interactive transaction with SET LOCAL-equivalent set_config(...,true), cleared defaults and an actual transaction-ID stamp; pooling tests cover commits, rollbacks, stale session variables and concurrency. |
| Existing tests could pass under an RLS-bypassing fixture role              | Fixture-only admin client separated from application client; auth and service tests now execute through the restricted runtime role.                                                                                     |
| WASM migration fallback corrupts dollar-quoted SQL by splitting semicolons | PostgreSQL simple-query execution of full migration scripts through a reserved connection; failures roll back. Fresh/repeat migrations and all integration tests also run with a non-superuser migration owner.          |

Baseline formatting, lint, route/type checks, 42 unit tests, 19 integration tests, migrations and build passed. The baseline HTTP attempt timed out against the old long-lived development server; it was not counted as passing. The server was restarted for final HTTP validation, and bounded request timeouts were added to the runner.

## Tenant-data inventory and coverage

| Model                                           | Ownership / access                                        | Database behavior under application role                                                                                                                                                                                                                |
| ----------------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Organization                                    | Root tenant; discovery limited to memberships             | Own membership discovery with actor-only context; selected tenant for edits; owner/admin update name; no direct runtime insert/delete. Narrow bootstrap function creates a new org and initial owner atomically.                                        |
| Membership                                      | organizationId + global userId                            | Selected tenant directory for members, own membership rows for discovery; owner role changes/deletion; invitation-bound self-insert for the exact invited role.                                                                                         |
| Invitation                                      | organizationId; normalized recipient; secret token hash   | Owner/admin create/read/revoke in selected tenant. Verified recipient may see only the exact supplied valid token, then accept in that tenant; only acceptedAt is runtime-updatable. OWNER invitations are rejected by a CHECK constraint.              |
| AuditEvent                                      | organizationId, actorId                                   | Tenant members read, current actor appends; runtime cannot update/delete.                                                                                                                                                                               |
| Contact                                         | organizationId; composite tenant/id and tenant/email keys | Members read within selected tenant; owner/admin create/update. Cross-context inserts/reparenting and foreign record updates fail. Runtime hard-delete is not granted; archive remains the product operation.                                           |
| User, Account, Session, Verification, RateLimit | Global Better Auth identity                               | Intentionally global and trusted by the identity subsystem; not described as tenant-isolated records. Member UI projects only name/email through authorized memberships. No public identity search/export or global account deletion feature was added. |

The integration suite inventories every physical table with organizationId plus the tenant root and asserts FORCE RLS. New tenant tables need their own reviewed policies, grants and adversarial tests. New child records must carry tenant-aware composite foreign keys to their parent; the existing Contact has no business child table yet.

## Request, context and pooling contract

Every Server Action still derives the actor from requireSession(). Resource IDs and FormData do not supply authority. Organization services retain current-membership checks, advisory locking, Zod validation, workflow rules and atomic audit writes.

`withActor` checks runtime privileges and policy readiness, starts an interactive transaction, and installs actor ID, selected organization (or empty discovery scope), optional invitation hash and pg_current_xact_id(). `withOrganization` authorizes inside that transaction. Do not return a transaction client, make global Prisma calls inside the callback or replace LOCAL settings with session-level SET.

Policies derive the actor only if the transaction-ID stamp matches the current transaction. Missing context denies tenant data. A stale session-level actor/tenant/stamp from a reused connection also fails closed in the next transaction. Queries have additional membership/role checks, so simply changing the selected organization to a foreign tenant does not grant access. A user belonging to both tenants is still limited to the selected context.

Validated: actual node-postgres pooling with a single reused backend, rollback cleanup, stale session settings and concurrent Prisma transactions. External PgBouncer/provider pooling was not deployed or tested. Transaction pooling is the intended protocol boundary; statement pooling is incompatible with interactive transactions. Validate the actual pooler and transaction timeouts in staging before release.

## Privileged functions and remaining trust

The migration owner has an explicit all-operations policy on each tenant table. FORCE RLS does **not** claim to restrict that trusted owner; the owner already controls DDL and can alter policies. The application is forbidden from owning/inheriting that role or connecting with its credentials.

Two SECURITY DEFINER functions run as the original migration owner: membership_role reads only the current actor's membership for a supplied organization, avoiding recursive membership policies; create_organization validates a verified actor and creates a new organization, initial owner and audit event atomically. They use fixed search paths, qualified tables, static SQL and explicit execute grants. PUBLIC has no private-schema/function access, and runtime cannot create schema objects. Ownership changes require a reviewed migration updating the corresponding owner policies; do not change function/table ownership ad hoc.

The GUC actor is trusted server context, not cryptographically bound to a browser session by PostgreSQL. A SQL injection, stolen runtime credential or malicious application code able to set an arbitrary actor and current transaction stamp can impersonate that actor. RLS here contains missing predicates, foreign IDs, wrong tenant selection and pool-context leaks; it does not sandbox a fully compromised app or migration credential. Global identity tables are another intentional trusted boundary. Last-owner business rules still rely on service locking/checks rather than a database trigger.

## Local reproduction

No dependencies were added or updated.

```sh
# Existing .env and data are preserved. Loopback databases only.
npm run db:runtime:local
npm run db:generate:wasm
npm run db:migrate:wasm
npm run db:runtime:local
npm run db:test:prepare
npm run format:check
npm run lint
npm run typecheck
npm test
npm run test:integration
npm run test:migrations
npm run build
# In a separate process: npm run dev
npm run test:http
```

DATABASE_URL is the local migration/fixture credential. RUNTIME_DATABASE_URL is the application credential. TEST_DATABASE_URL and TEST_RUNTIME_DATABASE_URL point to the same local dedicated `_test` database using separate roles. Provisioning generates a runtime password only when absent, never prints it, preserves an existing password and refuses unsafe existing roles. Test cleanup removes only its own fixtures. The migration check creates/reuses a dedicated local database and NOLOGIN non-superuser owner. Its local administrative connection assumes that effective role using startup options; the runner explicitly verifies current_user and NOSUPERUSER/NOBYPASSRLS, plus table and definer-function ownership. This is not a claim of testing a separate production migration login. It it never drops/resets databases or volumes.

The original two migrations are unchanged. New migrations are additive, wrapped in transactions and tracked by normal Prisma migration checksums. The local failed initial development attempt was resolved through Prisma's supported migration API, not manual history edits. CI checks both upgrade/repeat migration behavior and a full fresh chain under a non-superuser owner.

## Production handoff — instructions only, not executed

Use a reviewed migration identity which owns the existing tables/functions and a separate login with NOINHERIT, NOSUPERUSER, NOBYPASSRLS, NOCREATEDB, NOCREATEROLE and no role memberships. Do not use a provider default admin identity. Provision authentication securely outside SQL files/chat; never copy local credentials to production. Runtime must not own the database/tables or have CREATE on public/bbd_private. Remove pre-existing broad PUBLIC privileges through a separately reviewed change if necessary.

After applying the complete migration chain with the migration identity, grant the runtime role only:

- USAGE on public and bbd_private.
- User: SELECT/INSERT/UPDATE; Session/Account/Verification/RateLimit: SELECT/INSERT/UPDATE/DELETE.
- Organization: SELECT and UPDATE(name,updatedAt).
- Membership: SELECT/INSERT/DELETE and UPDATE(role).
- Invitation: SELECT/INSERT/DELETE and UPDATE(acceptedAt).
- AuditEvent: SELECT/INSERT.
- Contact: SELECT/INSERT and UPDATE(name,email,company,status,updatedAt).
- EXECUTE on actor_id(), organization_id(), membership_role(text), invitation_recipient(text,text), create_organization(text,text,text) only.

The local helper is the executable grant reference; it deliberately refuses remote hosts. No schema default blanket grants or privileges on _prisma_migrations are needed. Only RUNTIME_DATABASE_URL belongs in the production application; DATABASE_URL belongs solely in the migration job. Apply both new migrations before enabling the updated runtime. Applying RLS alone does not secure a legacy process still using owner credentials: switch credentials and restart every application worker/pool as part of the reviewed cutover; startup and health reject an incomplete policy contract. No production role, database, service, subscription or deployment was created.

## Limits and follow-up

- Security-critical SQL, definer functions and provider-specific role setup require independent human review before merge/deployment.
- Browser JavaScript invitation submission and accessibility remain unverified. A hand-crafted no-JavaScript useActionState form POST stalled and was aborted at 20 seconds; the runner does not emulate React's browser transport. Invitation issuance/acceptance is verified at service/auth/database level. The HTTP isolation test sets up B's invitation through the actual authorized service and tests its rendered revoke action with A's real cookie. Reproduce the browser behavior before drawing a product UI conclusion.
- No HTTP search/export implementation exists; adversarial SQL search/count/export-shaped aggregation is tested without tenant filters. This is not a claim that an unimplemented export API is secure.
- Production dependency audit is separate from full development advisories. Existing braces advisory paths remain documented; no test/advisory checks were disabled.
- MFA/session inventory, durable email, nonce CSP, real pooler validation, backups/restore, and deployment controls remain separate release gates.
- After independent review accepts isolation, the next scoped CRM issue should add organization-scoped opportunities/pipeline stages with composite tenant foreign keys, explicit transition permissions, audit events and the same direct-RLS/HTTP negative tests.
