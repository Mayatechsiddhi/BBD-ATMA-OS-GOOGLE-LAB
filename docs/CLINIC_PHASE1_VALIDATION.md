# Clinic CRM Phase 1 — implementation and verification

Branch: feat/clinic-crm-mvp. Starting commit: 048d3897765e2f03a42ff217802963bd24510a08, matching security/tenant-rls-hardening when this milestone began. The working tree was clean before implementation. No main changes, PR #3 merge, deployment, production credential use or database reset occurred.

## Implemented

- Tenant-owned clinic lead creation/editing, normalized phone/optional email, sources, status pipeline, search and 25-row pagination.
- Lead-linked appointment booking/rescheduling, resource/lead overlap checks under the existing organization lock, status transitions and selected-day IST agenda.
- Lead-linked follow-up tasks with future due times, editing, overdue display, completion/cancellation and history.
- Live clinic dashboard, organization navigation, existing UI primitives, server-session actions, validation and atomic audit records.
- An additive migration for ClinicLead, Appointment and FollowUp, with FORCE RLS, composite tenant foreign keys, scoped indexes and consistency CHECK constraints. Runtime ownership checks/inventory cover eight tables, with reviewed column grants and no clinic DELETE privilege. Existing migrations are unchanged.

No application data was seeded. All generated test identities, leads, appointments, task titles and resources are synthetic. Real browser/HTTP auth verification uses the existing loopback Mailpit sink; no external delivery or business operation is simulated.

## Validation evidence

| Command                                              | Result                                                                                                                                                                                                                                                           |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| db:generate:wasm                                     | Generated the updated Prisma client using existing pinned official WASM tooling                                                                                                                                                                                  |
| db:migrate:wasm / db:runtime:local / db:test:prepare | Applied the additive migration and grants on local development and separate test databases without resetting data                                                                                                                                                |
| format:check / lint / typecheck                      | Passed                                                                                                                                                                                                                                                           |
| test                                                 | 84 unit tests passed: 43 existing plus 41 clinic validation/time/lifecycle cases                                                                                                                                                                                 |
| test:integration                                     | 45 tests passed: 34 existing plus 11 clinic cases                                                                                                                                                                                                                |
| test:migrations                                      | Fresh complete five-migration chain on bbd_clinic_migration_test; repeat applies nothing. Separate LOGIN has current_user = session_user, no superuser/BYPASSRLS, and expected table/function ownership. Same integration suite passes under runtime credentials |
| test:pooler                                          | Same integration suite passes through actual PgBouncer 1.26.1 transaction pooling, SCRAM and one server connection                                                                                                                                               |
| build                                                | Optimized production build passed, including all five new clinic page routes                                                                                                                                                                                     |
| test:http                                            | Passed real native clinic lead creation, IST booking, follow-up completion, dashboard rendering and foreign-session clinic page/action denial, alongside existing auth/CRM/CSRF/invitation checks                                                                |
| test:browser                                         | Chromium workflow passes existing invitation/auth checks plus clinic lead editing/pipeline, booking, confirmation, rescheduling/cancellation, follow-up completion, dashboard, member read-only UI and foreign-session booking replay/page denial                |
| licenses:inventory                                   | 819 packages; no missing declarations; no packages added                                                                                                                                                                                                         |
| npm audit --omit=dev / npm audit                     | Both report 0 vulnerabilities after the reviewed fast-uri 3.1.9 patch (current registry snapshot)                                                                                                                                                                |

Integration runs are repeated across direct, migration-login and pooler configurations; they are not 135 different cases. The new migration's full fresh-chain run happened on its first verification run; later runs preserve and reuse that dedicated database. Earlier test databases, passwords and volumes remain intact.

Clinic integration coverage includes populated A/B fixtures, member restrictions in services and raw database operations, missing/forged/dual-membership tenant contexts, nested reads, unscoped export-shaped aggregates, foreign known-ID mutations, composite foreign-key attacks, ownership-column updates, DELETE denial, same-resource competing bookings, same-lead overlaps, adjacent slots, cross-tenant independent schedules, invalid attendance/terminal transitions, past-time validation, deterministic pagination, scoped counts and transaction rollback after an invalid audit insert. No search/export HTTP endpoint is invented or claimed tested.

## Problems found during implementation

- Initial test assertions passed but the runner detected unhandled rejections from concurrent negative-test promises. Rejection handlers now attach immediately; clean reruns have no unhandled errors. The initial run is not counted as a pass.
- Starting the development server while type generation was running changed ignored .next/dev/types files during the check. Typecheck/build are now verified before starting the HTTP/browser server; no type-check rule or include was disabled.
- Fresh migration verification initially retained a hardcoded older database name. Creation now uses the same safely quoted name as the existence/ownership check, preserving the older database and enabling a fresh clinic chain.
- One expanded browser run hit its existing 20-second navigation deadline before the first clinic result; the same scenario/assertions passed on a warm rerun. This is not evidence of a production cold-start or response-time guarantee; staging performance remains unverified.
- Browser assertions were adjusted to wait for actual UI completion after redirects to the same agenda URL. Confirmation/cancellation must remove their action button before persistence is asserted; requests are not counted successful merely because a URL already matches.
- Cold development GET navigation once exceeded the former 20-second request bound during route compilation. GET warm-up navigation now allows 60 seconds; every native mutation, including clinic and invitation POSTs, retains its 20-second deadline. This is not a production response-time claim.
- Clinic search queries can contain contact names/phones; clinic URLs are excluded from development request logging. Browser checks cover the actual searched value and its encoded form, alongside credential/token exclusion.
- The inherited fast-uri 3.1.8 audit finding was addressed with the reviewed, range-compatible 3.1.9 leaf patch. No install hooks, TLS/checksum bypass, framework replacement or new dependency was introduced. Audit results are recorded separately from functional test results.

## Limits and next work

The current module uses IST only and consistent free-text practitioner/resource labels. A practitioner/room directory, clinic hours, granular reception permissions, configurable timezone, larger agenda/task pagination, recurring bookings, consent/retention processes and reminder outbox are next product work. No clinical chart, diagnosis, prescription, patient self-service or billing is implemented.

Scheduling/status invariants are checked by services within the organization lock; arbitrary SQL or compromised credentials remain outside that guarantee. RLS still trusts server actor context. Browser tests use Chromium against the local development server; native HTTP checks read complete POST responses with deadlines. Development RSC stream closure, other browser engines/accessibility, actual provider pooling/TLS, native migration CLI release execution, production SMTP, backup/restore and staging rollout remain unverified. These are not claimed as passed or production-ready. No merge or deployment approval is inferred from local tests.
