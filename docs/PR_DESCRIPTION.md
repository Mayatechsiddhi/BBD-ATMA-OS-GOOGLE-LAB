Implements the approved foundation scope of #1 in the existing commercial BBD repository, whose initial source consisted only of README.md.

Adds Next.js/TypeScript, PostgreSQL/Prisma persistence, Better Auth verified-email/password authentication and database sessions, organization switching/settings, OWNER/ADMIN/MEMBER authorization, expiring single-use invitations, member management and atomic audit events. Tenant reads/writes authorize current membership in a transaction; concurrent role updates cannot remove the last owner.

The first client workflow is real CRM lead intake → qualification → customer conversion, with archive, tenant-scoped uniqueness, validated transitions and persisted audit history. ATMA, agents, durable orchestration, marketing and industry packages remain explicitly planned boundaries.

Includes a source/version/license/enterprise-restriction audit, locked dependencies, retained third-party notices, local PostgreSQL/Mailpit setup, environment validation, CI, architecture, engineering instructions, security gates, deployment runbook and roadmap preserving the 26 November 2026 deadline.

Validation: clean frozen install, repeatable migrations, formatting, lint and route/type checks passed; 42 unit tests and 19 PostgreSQL/auth integration tests passed without skips; optimized production build passed; real HTTP/Server Action smoke passed including the CRM workflow. Production dependency audit reports zero vulnerabilities. The full audit records six development dependency paths through the unpatched braces advisory; this is documented rather than hidden.

Limitations: no production deployment/access or external email delivery; no claim of operational production readiness. RLS, MFA/session inventory, durable email delivery, nonce CSP, browser/accessibility tests and deployment security gates remain documented work. Prisma binary downloads are blocked in this cloud instance; the checked-in, pinned official WASM fallback is verified. GitHub Actions is configured but has not been run remotely from this environment. See docs/VALIDATION.md for evidence and scope limits.
