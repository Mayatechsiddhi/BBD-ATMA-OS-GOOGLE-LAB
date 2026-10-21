# Tenant-isolation validation — 20 October 2026

Historical baseline. See [PR #3 review follow-up](PR3_REVIEW_FOLLOWUP.md) for the subsequent browser, authenticated migration-login and PgBouncer evidence.

Base: `feat/issue-1-production-foundation` at `e8850236bf4dd801f4706ba5b4a6727c5353d143`.
Review branch: `security/tenant-rls-hardening`.

## Verified outcomes

| Command/check                         | Actual result                                                                                                                                               |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Baseline format/lint/type-check/build | Passed                                                                                                                                                      |
| Baseline unit/integration suites      | 42 unit and 19 integration tests passed                                                                                                                     |
| Baseline database role/RLS inspection | Application used superuser/bypass role; all five tenant tables had RLS disabled                                                                             |
| Final `format:check`                  | Passed                                                                                                                                                      |
| Final `lint`                          | Passed, no warnings/errors                                                                                                                                  |
| Final `typecheck`                     | Passed with generated Next.js route types                                                                                                                   |
| Final `test`                          | 43 passed; 0 failed/skipped                                                                                                                                 |
| Final `test:integration`              | 34 passed; 0 failed/skipped (19 existing + 15 isolation tests)                                                                                              |
| `test:migrations`                     | Full chain applied on a new dedicated local database on its first run; repeat runs applied nothing. All 34 integration tests passed there too               |
| Non-superuser migration verification  | Actual current_user and NOSUPERUSER/NOBYPASSRLS checked; ownership of all five tenant tables and both SECURITY DEFINER functions checked                    |
| `build`                               | Optimized production build passed                                                                                                                           |
| Final `test:http`                     | Passed: real verified accounts, CRM lifecycle, A's cookie rejected on B's real pages and captured settings/CRM/member-removal/invitation-revocation actions |
| Production `npm audit --omit=dev`     | 0 reported vulnerabilities                                                                                                                                  |
| Full `npm audit`                      | Expected nonzero: 6 existing high development-dependency paths through braces                                                                               |
| `licenses:inventory` + inventory diff | 818 locked packages, no missing declarations; inventory unchanged                                                                                           |
| Original SQL migrations 001/002       | Unchanged; applied migration SHA-256 checksums validated by the integration suite                                                                           |
| New dependencies / version changes    | None; package-lock unchanged                                                                                                                                |

Test counts above are unique cases. The migration run repeats the same 34 integration cases under a second effective database owner; it is not claimed as 68 different tests. The migration test uses a local admin connection assuming a NOLOGIN non-superuser effective role, with explicit metadata checks; a production login/provider is not claimed tested.

## Adversarial scenarios exercised

- Unscoped reads of all five tenant tables without context return nothing under the app role. Original privileged credentials reproduce broad access and are now rejected by the runtime guard.
- Actor-only discovery yields only own workspaces/memberships; foreign selected tenant and missing membership fail closed.
- Omitted tenant predicates, nested member reads, foreign known IDs, broad updates/deletes, search, counts and export-shaped JSON aggregation do not expose/change another tenant.
- A user belonging to both organizations cannot write to B from A's active context. INSERT WITH CHECK/column privileges prevent cross-tenant creation/reparenting.
- Members remain read-only at the database boundary; audit actor forgery, audit mutation/deletion, contact hard-delete, organization deletion, migration-history access and global user deletion are denied.
- Verified invitation tokens expose only their addressed invitation, cannot grant OWNER, cannot change recipient fields and do not open contact access before membership acceptance.
- Commit/rollback on one reused backend clears context; stale session settings are invalid in later transactions; concurrent pooled transactions remain isolated.
- Owner self-removal retains another owner and its atomic audit record. Existing last-owner/concurrent demotion, auth/recovery, token replay, expiry and revocation tests remain enabled and passing.
- Actual HTTP authorization is checked with an A session against B's existing resources and B's captured bound action metadata, not merely a made-up tenant ID.

## Failures encountered and resolved

The old long-lived development server stalled the baseline HTTP attempt; this was not counted as a pass. The server was restarted and request timeouts were bounded. The old WASM adapter split SQL comments/functions on semicolons; complete-script execution fixed migration application. Initial RLS INSERT RETURNING rules hid the invitation recipient's own new membership; a narrowly scoped self-read policy corrected it. Full suites were rerun after these changes.

A hand-crafted no-JavaScript useActionState invitation-creation POST also stalled at 20 seconds. It is **not** reported as passed or as a confirmed browser defect. The HTTP runner does not emulate React browser transport; invitation creation is fixture setup through the real authorized domain service, while actual rendered revoke actions are tested over HTTP. Browser reproduction of invitation submission remains an explicit follow-up. Original existing tests were not skipped, disabled or weakened to conceal this result.

## Limits and review requirements

No production access, deployment, infrastructure purchase, automatic merge, external SMTP delivery or external pooler setup occurred. Human review of definer functions, owner-policy exceptions, runtime grants and rollout sequencing is required. RLS trusts server-supplied actor context and does not contain arbitrary SQL execution or stolen runtime/migration credentials. Identity records are intentionally global. Last-owner/workflow business invariants remain service rules. See TENANT_ISOLATION.md and SECURITY.md for the complete boundary and release gates.

CI was extended with runtime-role provisioning and non-superuser migration validation; local execution is verified. Remote CI status is not claimed because the GitHub API is blocked. PR publishing outcomes are recorded after the push attempt.

## Publishing outcome

The hardening implementation was committed as `ba852fed20a00996f6d786faf9d6195874d4fe73` and pushed to `origin/security/tenant-rls-hardening`; remote Git readback matched. Both `gh pr create` (GraphQL) and the REST pulls endpoint returned Forbidden. No PR number was returned and no created PR is claimed. This is a GitHub API access blocker, not a failed code/test check.

Review the pushed branch against `feat/issue-1-production-foundation` and use `docs/TENANT_ISOLATION_PR.md` as the PR body. Manual comparison/creation link: https://github.com/bloomdigital369-hue/BBD-MASTER-ATMA-OS/compare/feat/issue-1-production-foundation...security/tenant-rls-hardening?expand=1 . API creation can be retried after api.github.com access is restored. No new token is requested; native Git push already works. No automatic merge or deployment occurred.
