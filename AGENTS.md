<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# BBD engineering continuity

This checkout is the commercial BBD Master ATMA OS product. Read `ARCHITECTURE.md`, `ROADMAP.md`, `SECURITY.md`, and `docs/SOURCE_AND_LICENSE_AUDIT.md` before changes. Do not represent planned modules as working business operations.

## Working agreement

- Use the existing isolated checkout. Do not create a worktree unless explicitly requested.
- Preserve user changes. Never deploy, touch production, reset databases, delete volumes, or install unreviewed software without authorization.
- Review dependency versions, licenses, install hooks and security advisories before installing; keep exact pins and the lockfile. Do not change the product's licensing terms.
- Keep secrets out of source, responses, URLs, screenshots and logs. `.env` is local and ignored.
- Derive the actor from `requireSession()` inside every Server Action. Never accept an actor ID from a browser. Re-read membership in a transaction for every tenant operation.
- Route tenant reads and writes through the organization/CRM services and `src/modules/organizations/access.ts`. UI visibility is not authorization. No cross-request caching of sessions or permissions.
- Add organizationId and scoped keys/foreign keys to every new tenant business model. Tenant isolation currently lives in the service layer, not PostgreSQL RLS; do not claim RLS exists.
- Tenant mutations and audit events commit together. Serialize access-changing writes and preserve at least one owner. Add negative cross-tenant and concurrency tests with new mutations.
- Keep reusable UI primitives under `src/components/ui`, domain logic under `src/modules`, HTTP and presentation under `src/app`.
- No secrets or access tokens in agent prompts. Future AI execution must authorize tenant, tool and resource and record approvals before side effects.

## Checks

See README for setup. Required: `npm run lint`, `npm run typecheck`, `npm test`, `npm run test:integration`, `npm run build`, and `npm run test:http` against a running local development server. Integration tests require a separate migrated database ending `_test` and local Mailpit. Tests remove only their own fixtures; never reset an existing database.

On cloud machines with an unwritable home cache, export `npm_config_cache=/workspace/.npm-cache`. Default Prisma CLI commands require `binaries.prisma.sh`; the pinned `db:generate:wasm` and `db:migrate:wasm` development fallback is documented and tested. Do not disable TLS, checksum, signature, CSRF or authorization checks to make tests pass.

Update ROADMAP and validation evidence when behavior changes. Report actual failures and skipped checks. A passing build does not establish production readiness.
