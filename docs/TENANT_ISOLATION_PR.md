The foundation connected as a PostgreSQL superuser and had no RLS on tenant data. This PR introduces a separate restricted runtime connection, FORCE RLS on all five tenant tables, transaction-local actor/tenant context bound to the current transaction ID, and membership/role-aware policies. It preserves service authorization and original migrations. Narrow SECURITY DEFINER functions use fixed search paths and explicit grants; the migration owner remains trusted.

The review follow-up fixes invitation POST stalls by using a stable action reference and retaining same-origin Origin headers for CSRF validation. Submitted organization IDs remain untrusted selectors authorized against the server session. It also prevents pre-hydration authentication/recovery forms from sending credentials through GET, and disables development argument traces that could expose previous invitation tokens.

Validation now includes populated A/B PostgreSQL fixtures, a separately authenticated restricted migration LOGIN, actual PgBouncer 1.26.1 transaction pooling, real native invitation POSTs, and Chromium invitation flows. Playwright Core 1.64.1 is the only added development package; its Apache-2.0 license and install metadata were reviewed. PgBouncer is a reviewed, digest-pinned local test container. Development uses supported webpack mode after this environment reproduced Turbopack reload loops; the production build command is unchanged.

Verified locally:

- Lint, typecheck, format and production build pass.
- 43 unit tests and 34 direct PostgreSQL integration tests pass.
- The same 34 integration cases pass under the separately authenticated migration owner and through PgBouncer; these are repeated runs, not additional unique cases.
- Fresh/repeat migrations, role privileges, table/function ownership and original migration checksums pass.
- HTTP tests pass, including actual invitation issuance, foreign-session denial, CRM persistence and CSRF rejection.
- Chromium passes eight check groups: issuance, foreign-session replay, forged role rejection, repeated submission, recipient matching/acceptance/replay, pre-hydration credential safety, native no-JavaScript issuance and server-log secret exclusion.
- Production dependency audit: zero findings. Full audit: six existing high development dependency paths through braces. License inventory: 819 packages, no missing declarations.

See [exact evidence, failures and limitations](https://github.com/bloomdigital369-hue/BBD-MASTER-ATMA-OS/blob/security/tenant-rls-hardening/docs/PR3_REVIEW_FOLLOWUP.md).

Review the SQL owner-policy exception, definer functions, runtime grants, invitation bootstrap and migration cutover. RLS trusts server actor context and does not contain arbitrary SQL execution or stolen credentials. Browser checks assert bounded UI completion/persistence; development RSC stream closure is not claimed verified. Native HTTP separately verifies full-body completion. Managed-provider pooling, production SMTP/TLS, staging, other browser engines, accessibility and deployment controls remain release gates. GitHub API access is blocked, so remote CI status is unverified. No production access, merge, deployment or infrastructure spending occurred.

Base: feat/issue-1-production-foundation. Do not merge automatically.
