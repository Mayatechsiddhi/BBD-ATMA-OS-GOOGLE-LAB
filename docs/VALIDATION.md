# Foundation validation evidence

Historical foundation evidence follows. The later isolation audit and current results are in [TENANT_ISOLATION.md](TENANT_ISOLATION.md) and [TENANT_ISOLATION_VALIDATION.md](TENANT_ISOLATION_VALIDATION.md).

Validated locally on 20 October 2026 (Asia/Kolkata client date). The repository began at `6153dad3ff667292a1a8fe81d6d28faa0c4c5023` with only README.md. Issue #1's scope and 26 November 2026 delivery deadline were supplied by the user after direct GitHub API access was blocked.

## Executed checks

| Check                                                        | Actual outcome                                                                                                                      |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| Clean `npm ci --ignore-scripts` and reviewed esbuild rebuild | Passed; frozen lockfile install reproduced dependencies                                                                             |
| `scripts/init-dev.mjs`                                       | Created ignored local secrets initially; repeat run preserved the existing .env                                                     |
| `db:generate:wasm`                                           | Passed using official npm-integrity-verified Prisma tooling                                                                         |
| Two committed PostgreSQL migrations                          | Applied to local development and separate integration database                                                                      |
| Migration repeatability / `db:test:prepare`                  | Passed; subsequent runs reported no unapplied migrations, without resetting data                                                    |
| `format:check`                                               | Passed                                                                                                                              |
| `lint`                                                       | Passed with no errors or warnings                                                                                                   |
| `typecheck`                                                  | Passed, including Next.js route generation                                                                                          |
| Unit tests                                                   | 42 passed, 0 failed, 0 skipped                                                                                                      |
| PostgreSQL/auth integration tests                            | 19 passed, 0 failed, 0 skipped                                                                                                      |
| `build`                                                      | Passed, optimized Next.js build including the CRM route                                                                             |
| `test:http` with actual Next.js development server           | Passed; real HTTP requests, cookies and Server Action forms                                                                         |
| `npm audit --omit=dev --audit-level=high`                    | Passed; 0 reported production dependency vulnerabilities                                                                            |
| Full `npm audit`                                             | Nonzero as expected: 6 high-severity development dependency paths sharing the documented braces advisory; see dependency-audit.json |

The clean install was followed by generation, repeat migrations, formatting, lint, route/type checks, all unit and database tests, and the production build. The final verification-redirect improvement was checked by type-check, rebuild and a further actual HTTP smoke run. Configuration and CI documentation checks do not imply a remote CI run.

## What the tests exercise

- Real signup, SMTP delivery to local Mailpit, verified-email enforcement, password hashing, sign-in, database sessions, tampered cookie rejection, sign-out, password reset, reset-token replay rejection and revocation of existing sessions.
- Persisted auth rate limits and cross-origin auth mutation denial. Explicit origin/CSRF checks stay enabled even when NODE_ENV=test.
- Organization creation and membership persistence, tenant-only listing, denied foreign reads/writes, member read-only access and administrator restrictions.
- Last-owner protection and concurrent role changes; atomic successful mutation/audit writes.
- Invitation token hashing, verified recipient matching, expiry, revocation, single-use acceptance under concurrency, and immediate access removal.
- Real CRM lead → qualified → customer → archived lifecycle, per-tenant email uniqueness, foreign contact-ID rejection, read-only member behavior, invalid state skips and duplicate concurrent transition rejection with accurate audit records.
- Running Next.js: health, auth routes, verified signup callback, protected redirects, server-rendered organization/admin pages, organization creation/settings via actual form POSTs, CRM creation and transitions via actual Server Action forms, audit persistence, missing tenant denial and framework CSRF rejection.

Tests create isolated fixture identities and organizations and remove only those fixtures. No business records are seeded as if they were real customers. Mailpit messages are local test messages, not outbound email.

## Known blockers and unrun checks

- `binaries.prisma.sh` is blocked by the current cloud proxy. Default Prisma CLI generation/migration downloads therefore failed. The pinned official WASM path was implemented and tested without disabling TLS/checksum verification. Default CLI downloads remain unverified until network policy is applied.
- `api.github.com` requests from authenticated gh are blocked by the proxy. This prevents direct issue retrieval and PR creation. Native Git read is verified separately; push/PR results are recorded at handoff rather than inferred from read permission.
- Network additions and reusable install/start instructions were saved to the cloud configuration draft. They are not claimed applied, published or validated in a fresh cloud task.
- No production deployment, production database connection, external SMTP delivery, full browser automation, accessibility audit, OS image vulnerability scan, production load test or multi-instance deployment test was performed.
- Tenant isolation is enforced by services and scoped database keys, not RLS. Production hardening, MFA, session inventory, trusted ingress, mail outbox, backup/restore and remaining gates are tracked in SECURITY.md and ROADMAP.md.

## Changed implementation areas

- Application: `src/app` routes and actions for identity, organizations, dashboard, settings, members, invitations, recovery, CRM, health and planned module catalog.
- Domain: `src/modules/organizations` transaction/permission boundary and organization lifecycle; `src/modules/crm` validated persisted client workflow; planned module registry.
- Infrastructure/UI: `src/lib` database/auth/session/SMTP/configuration/logging, `src/components/ui` shadcn-style primitives and form components, Tailwind/theme and framework configuration.
- Persistence: `prisma/schema.prisma` and the foundation/client-workflow SQL migrations.
- Verification/setup: `tests`, `scripts`, digest-pinned `compose.yaml`, environment example, exact dependency manifest/lockfile and SHA-pinned CI workflow.
- Continuity/audit: AGENTS.md, ARCHITECTURE.md, ROADMAP.md, SECURITY.md, README.md, DEPLOYMENT.md, source/license audit, SPDX inventory, dependency audit snapshot and preserved upstream notices.

## Git publishing handoff

Foundation code was committed as `bbf15be` and successfully pushed to `origin/feat/issue-1-production-foundation` in the existing repository. PR creation was attempted using both `gh pr create` (GraphQL) and the REST pulls endpoint; both returned Forbidden from the current environment route. No PR number or successful creation response was returned, so no existing PR is claimed.

GitHub's successful push response supplied this manual creation link: https://github.com/bloomdigital369-hue/BBD-MASTER-ATMA-OS/pull/new/feat/issue-1-production-foundation . Use the title/body in `docs/PR_DESCRIPTION.md`, or retry the API after the saved api.github.com network setting is applied. No additional token is requested; injected Git authentication already supports push.

The cloud configuration draft save confirmed persistence of install_script and start_skill, plus the requested network domains. Review/save those settings and publish the cloud environment to retain the prepared snapshot; this is separate from application deployment, which was not performed. A fresh-task restore has not been tested.
