# Bharath Bloom Digital — Master ATMA OS

The commercial BBD operating system foundation: real identity, PostgreSQL-backed organizations, tenant access controls, a workspace administration shell and a persisted lead-to-customer CRM workflow. ATMA, AI agents, durable workflow orchestration, marketing and industry packages have defined architecture boundaries and are not implemented business capabilities yet.

## Local prerequisites

Node.js 22.12+ (22.x) or 24.x, npm, and Docker Compose. Direct dependency versions are pinned. Review `docs/SOURCE_AND_LICENSE_AUDIT.md` before installing or redistributing third-party software.

## Set up

```sh
npm ci --ignore-scripts
npm rebuild esbuild
node scripts/init-dev.mjs
docker compose -p bbd-atma-dev up -d --wait
npm run db:runtime:local
npm run db:generate
npm run db:migrate
npm run db:runtime:local
npm run dev
```

`init-dev` creates an ignored `.env` with fresh local-only database/auth secrets and refuses to overwrite an existing file. If configuring manually, use `.env.example`; set the database password consistently in DATABASE_URL and POSTGRES_PASSWORD. No production credentials are needed. Existing environments should keep their secrets and databases.

If `binaries.prisma.sh` is restricted, use the reviewed npm-packaged official WASM tools instead of the two Prisma commands:

```sh
npm run db:generate:wasm
npm run db:migrate:wasm
```

Run `db:runtime:local` again after migration to grant the local runtime role its explicit privileges. `db:test:prepare` migrates and grants privileges on the separate test database. These commands preserve Prisma migration history/checksums and are tested for repeatability. They use pinned internal APIs and must be revalidated when upgrading Prisma. Never disable checksum or TLS verification. The remaining Next.js native packages arrive through npm's integrity-verified platform packages. Cloud machines with an unwritable home cache can export `npm_config_cache=/workspace/.npm-cache` first.

Open the application on your local machine, create an account, and verify the delivered email in the local Mailpit inbox on port 8025. Sign in, create an organization, then manage settings and people. Open Client relationships to capture a lead, qualify it and convert it to a customer; transitions persist with audit records. Invitations are private links delivered manually to the intended recipient; the recipient must create and verify the exact invited email and paste the link again after signing in. Invitation fragments are cleared after filling the token form. No real external email is sent by Mailpit.

## Validate

```sh
npm run lint
npm run typecheck
npm test
npm run db:test:prepare
npm run test:integration
npm run test:migrations
npm run test:pooler
npm run build
# With npm run dev running separately:
npm run test:http
npm run test:browser
```

`db:test:prepare` creates a separate local `_test` database if absent, then applies migrations. It never drops or resets a database. Integration tests require TEST_DATABASE_URL and Mailpit; they delete only generated fixture identities/organizations. HTTP smoke tests use local development and remove only their own fixtures. Neither suite is permitted against production hosts. Build output is checked separately from runtime HTTP functionality.

The pooler check starts a digest-pinned PgBouncer container on loopback port 6432, runs the integration suite in transaction mode, and removes only that temporary container. Browser checks use Playwright Core with an existing Chromium (`CHROMIUM_PATH`, default `/usr/bin/chromium`). Set BROWSER_SERVER_LOG to the current local server log to assert that fixture secrets are absent. The migration check uses its own restricted LOGIN and dedicated database; `.env.migration-test` holds its generated local password, is ignored, and is never a production credential.

Development explicitly uses Next's supported webpack mode after browser runs reproduced a sign-in reload loop under this environment's Turbopack development server. `next build` remains unchanged. Browser checks wait for bounded UI completion and database persistence; they do not use development RSC stream closure as a substitute for user-visible completion. The HTTP suite separately reads the complete native invitation POST response with a 20-second deadline.

## Database isolation

The app uses `RUNTIME_DATABASE_URL`; `DATABASE_URL` is reserved for migrations and local fixture cleanup. Never use migration credentials as an app fallback. Local role provisioning is loopback-only, preserves existing passwords, and grants no owner, bypass, schema-creation or migration privileges. Tenant data is protected by FORCE RLS in addition to service authorization. See [the isolation audit](docs/TENANT_ISOLATION.md) for role setup, pooling, exceptional bootstrap paths, tests and limitations.

## Production configuration

`.env.example` lists runtime requirements. `npm start` validates configuration and starts the built app; production requires an HTTPS auth URL and authenticated SMTP. Real production SMTP must support verified TLS. Use managed secret injection, a least-privilege database role, backups and a reviewed HTTPS ingress. Do not use local Mailpit or development database credentials. Follow `docs/DEPLOYMENT.md` and complete the gates in SECURITY.md before public launch. No deployment or production system access is included in this milestone.

## Project map

- `src/app`: routes, authenticated shell, Server Actions and auth/health endpoints.
- `src/modules/organizations`: validation, authorization and transactional tenant services.
- `src/modules/registry.ts`: explicit planned module boundaries.
- `src/components/ui`: owned shadcn-style UI primitives; `components.json` configures shadcn conventions.
- `src/lib`: identity, sessions, database, SMTP, validation and logging.
- `prisma`: schema and committed migrations.
- `tests`, `scripts`, `.github/workflows`: automated verification and repeatable local setup.
- `AGENTS.md`, `ARCHITECTURE.md`, `ROADMAP.md`, `SECURITY.md`: persistent engineering context.

The repository initially contained only its product description README. No existing test repository or application code was imported. See `docs/VALIDATION.md` for actual evidence and limitations.
