# Source and third-party licensing audit

## PR #3 review follow-up — 21 October 2026 (IST)

Added only `playwright-core` 1.64.1 as an exact development dependency for real browser regression tests. npm metadata, Node >=20 compatibility, absence of install hooks, Apache-2.0 declaration and installed LICENSE were reviewed before execution. npm lock integrity is retained; the inventory now contains 819 packages. No browser binary is bundled into the application. Tests use the existing Chromium installation; CI may use its preinstalled Chrome via CHROMIUM_PATH. Browser distribution terms are separate from Playwright's license.

The local pooler runner uses `edoburu/pgbouncer` at amd64 manifest digest `sha256:a26a00a576e248e73230eff35c8fbe77279bf0d8b6550d3007c56ee69287c664`. Runtime reports PgBouncer 1.26.1, libevent 2.1.13 and OpenSSL 3.5.8. Reviewed upstream Dockerfile and MIT container-wrapper LICENSE at edoburu/docker-pgbouncer (HEAD readback `f0b69975fffce835643f3b3a5b7cec5ed2c3adea`), plus PgBouncer's upstream ISC COPYRIGHT. The runner overrides the image entrypoint with explicit local test configuration. Digest verification identifies the tested artifact; it does not attest a reproducible source build or establish a clean OS vulnerability scan. This test image is not a production deployment selection.

## Baseline and provenance

The inspected main/initial commit `6153dad3ff667292a1a8fe81d6d28faa0c4c5023` contained only a 212-byte README describing BBD Master ATMA OS. There was no application code, dependency manifest, test suite, agent file or repository LICENSE. The working tree was clean before foundation implementation. No previous test repository, business dataset, customer credential or production system was imported.

Product-specific files in this milestone were authored for this repository. The UI primitives follow shadcn/ui's MIT-licensed composition conventions; the shadcn notice is preserved under `docs/licenses/shadcn-ui.txt`. No CLI template repository was cloned. There is no assumption that BBD product source is MIT-licensed: no project-wide license grant has been added. The owner must determine proprietary terms separately.

## Reviewed software

Before executing dependency install hooks, registry license/version metadata and lockfile SPDX declarations were inspected. Installation initially used `--ignore-scripts`; reviewed native tooling was then rebuilt. Packages are pinned in package.json; transitive artifacts and hashes are locked in package-lock.json. Do not use this inventory as a substitute for legal review of distribution terms.

| Component                          | Reviewed version               | License                                      |
| ---------------------------------- | ------------------------------ | -------------------------------------------- |
| Next.js / eslint-config-next       | 16.4.2                         | MIT                                          |
| React / React DOM                  | 19.3.1                         | MIT                                          |
| Better Auth                        | 1.7.11                         | MIT                                          |
| Prisma client, adapter and tooling | 7.10.1                         | Apache-2.0                                   |
| PostgreSQL driver pg               | 8.23.1                         | MIT                                          |
| TypeScript                         | 5.9.3                          | Apache-2.0                                   |
| Tailwind and PostCSS plugin        | 4.3.3                          | MIT                                          |
| Radix UI                           | 1.8.1                          | MIT                                          |
| class-variance-authority           | 0.7.1                          | Apache-2.0                                   |
| clsx / tailwind-merge              | 2.1.1 / 3.7.0                  | MIT                                          |
| lucide-react                       | 1.59.0                         | ISC                                          |
| Zod / Pino                         | 4.6.7 / 10.4.0                 | MIT                                          |
| Nodemailer                         | 10.1.7                         | MIT-0                                        |
| ESLint                             | 9.39.5                         | MIT                                          |
| Vitest / tsx / Prettier            | 5.0.5 / 4.23.15 / 3.9.10       | MIT                                          |
| PostgreSQL 17 container            | content digest in compose.yaml | PostgreSQL License plus image/system notices |
| Mailpit 1.29.2 container           | content digest in compose.yaml | MIT plus image/system notices                |

ESLint 9 is retained because Next's current React/import/accessibility plugins declare compatible peer support through version 9; version 10 produced incompatible peer warnings. Version 9 is deprecated upstream, so track the compatible Next/plugin update. Prisma 6 was rejected after its deepmerge-ts advisory was identified; Prisma 7.10.1 is the selected patched stable release. Prisma's stable distribution includes a commit-pinned WASM engine package with a prerelease-style internal version; it is not an independently selected application prerelease.

## Transitive obligations

The lockfile inventory is saved in `docs/dependency-licenses.json` and can be regenerated with `npm run licenses:inventory`. No package had a missing license declaration in the reviewed lockfile. The tree includes permissive MIT, Apache-2.0, ISC, BSD, 0BSD, Python-2.0, BlueOak, CC0 and CC-BY-4.0 declarations, plus:

- LGPL-3.0-or-later: Next.js/Sharp prebuilt libvips and related platform variants. Retain notices and applicable source/relinking information when distributing those artifacts. This milestone does not modify them. Do not assume all Next.js bundled native libraries are MIT.
- MPL-2.0: lightningcss platform packages and axe-core development tooling. Preserve notices and source obligations for any distributed modifications.
- CC-BY-4.0: caniuse-lite data attribution must be retained if redistributed.

Container base images contain additional operating system packages; the PostgreSQL/Mailpit top-level licenses do not describe the whole image. Production artifact SBOMs, notice bundling and legal signoff remain release tasks. No third-party source notices are stripped. Security advisories are tracked separately in SECURITY.md and validation evidence.

Authoritative references reviewed: npm registry metadata and installed package LICENSE files; PostgreSQL's official `postgres/postgres` COPYRIGHT; Mailpit's official `axllent/mailpit` LICENSE; shadcn-ui/ui LICENSE.md. Package integrity remains enforced by npm. No third-party services, model APIs or proprietary SDKs were connected.

## Enterprise and hosted-service restrictions

The implemented path uses the open-source, self-hosted editions. No Better Auth hosted infrastructure, paid enterprise plugin, Prisma Accelerate/Console service, Vercel hosted platform feature, commercial shadcn registry/theme, model provider or proprietary SDK is included. Their service terms or separate enterprise code are not granted by the open-source library licenses and must be reviewed before adoption. The selected organization/role implementation is BBD-owned service code, not copied enterprise functionality. No external font or licensed design asset is downloaded.

GitHub Actions checkout and setup-node v6 were resolved to exact public Git SHAs in CI; their official MIT licenses were reviewed. Container manifests are digest-pinned; a production image needs a full OS-level SBOM and scan in addition to this JavaScript inventory. This audit records source provenance, declared licenses, versions and automated advisories; it is not an exhaustive manual security review or legal certification of every transitive source file.

Issue #1 scope was supplied verbatim by the user after authenticated GitHub API retrieval was blocked. The local work follows that supplied scope; no claim is made that the live issue state or comments were read.

## Clinic Phase 1 — 27 October 2026

The clinic module, SQL migration, UI and tests are original repository code using existing Next.js, Prisma, Better Auth, Zod and UI packages. No new direct or transitive package was added. A current npm audit identified fast-uri 3.1.8 URI-normalization advisories (GHSA-w74x-v6f9-j3xg, GHSA-xhq7-xmqj-769h, GHSA-wjr9-j795-jxcr and GHSA-333x-w4r6-6crp) in the inherited tree. The compatible leaf patch to 3.1.9 fits Ajv's existing ^3.0.1 range. Registry metadata, BSD-3-Clause LICENSE, absence of install lifecycle hooks and npm integrity were reviewed before installation with --ignore-scripts. Only that package's version/resolved URL/integrity and its license inventory version changed; inventory count remains 819. No auth/framework/database dependency version or product licensing terms changed. Current audit outcomes are recorded in CLINIC_PHASE1_VALIDATION.md; earlier audit snapshots above are historical.
