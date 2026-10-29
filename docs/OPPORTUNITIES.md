# CRM opportunities

Implemented on feat/crm-opportunities, based on PR #6's reviewed head 77c1b6dd61dce47a970b7d2597a2996b68002e17. PR #6 and its branch are preserved. This feature reuses Contact, authentication, organization transactions, audit, existing cards/inputs/buttons and the CRM navigation. No new dependency, external API or AI call is introduced.

## Working feature

Client relationships links to Opportunities. OWNER/ADMIN create an opportunity against an active existing contact, with a title and estimated INR value stored as integer paise. Stages are OPEN → PROPOSAL → WON, with LOST available from OPEN/PROPOSAL. Terminal deals cannot reopen. Stage changes use optimistic versions under the existing organization lock, with atomic audit events. A per-tenant request UUID makes replay of the same creation form idempotent; a changed payload with the same key is rejected. Deliberate new forms may create separate deals for the same contact.

Search covers title/contact name/email, with stage filters and deterministic 25-record pagination. Stage counts cover the whole tenant, not just the filtered page. Values are estimates, never payment/revenue claims. MEMBER reads only; DISPLAY and nonmembers cannot access opportunity services/pages/data. The new twelfth FORCE-RLS table has a composite tenant Contact foreign key. Runtime has SELECT/INSERT and UPDATE only on stage/version/updatedAt; no delete, identity/value/title update or tenant reassignment is granted. Existing doctor scheduling/queues/display remain intact.

Scope limits: fixed INR and stages, no value/title editing, deletion, reopening, ownership assignment, expected-close dates or forecasting. The contact picker reuses the existing unpaginated contact directory; opportunity records themselves are paginated. No real customer records or example deals are seeded.

## Actually accessible third-party originals

Only this uploaded archive was found in attachments/library-files/shared/scratch: `/workspace/attachments/57bb6940-6981-4517-b30d-f1229bd3d2a4/BBD-CLINIC-REUSE-PACK-01.zip`. Its accessible original files are:

- quarantine/02-Sales_AI_Agent___WhatsApp_TEMPLATE.json
- quarantine/02-TEMPLATE - AI Agent Whatsapp Booking Assistant For Businesses - fabimarkl.com 1.json
- quarantine/02-Template - AI Receptionist VAPI - Fabimarkl.com.json
- quarantine/02-Template - v1.1 Voice Call Reminders for Appointments.json
- quarantine/02-TEMPLATE___WhatsApp_AI_Agent___Appointment_Setter.json
- quarantine/04-TEMPLATE___AI_Agent_Voice_Booking_Assistant_v1_2___fabimarkl_com 2.json

No standalone original HTML/CSS/JavaScript or author-specific SKILL.md paths were supplied/found. Some accessible workflow JSONs contain embedded JavaScript code nodes; those are also not licensed for incorporation. The named authors' complete collection roots are unavailable; filenames alone do not establish course ownership. The archive explicitly records commercial rights as UNVERIFIED and supplies no license grant. No third-party code/prompts/workflow JSON were copied, executed or committed. This implementation directly reuses BBD's working components; it does not claim integration of unavailable/unlicensed originals.

## Validation and release gates

Unit tests cover exact money parsing, bounds, selectors and transitions. PostgreSQL tests cover concurrent create replay/audit uniqueness, stage concurrency, role and cross-tenant/dual-member denial, missing-context writes, direct RLS/FK/immutable identity/delete denial and pagination beyond 25 records. The browser runner adds real contact → opportunity → proposal → won, duplicate POST replay, search, tenant denial and member read-only checks, while retaining every clinic/invitation/calling case. Search URLs are excluded from development request logging.

Completed checks: 115 unit tests, 22 privilege regressions and 71 integration tests in each of direct PostgreSQL, restricted migration-owner and transaction-mode PgBouncer configurations passed. The unchanged 819-package license inventory and full/production dependency audits passed (zero reported advisories at this snapshot). Focused real-auth opportunity browser flow and its secret-log exclusion passed. Final generation/format/lint/typecheck/build and HTTP passed against the final app code. An early unit import exposed a DB side effect in validation; pure rules were separated from persistence without a fallback credential or mock bypass. An early full run stopped on new browser-file formatting; corrected with the existing pinned formatter.

Apply the additive tenth migration and explicitly reviewed runtime grants only as part of an independently approved release. Parent artifacts reject extra grants/tables, so coordinated migration/grant/artifact rollout and rollback are required. No deployment or production database changes occurred. Human security review of this feature and its unmerged ancestry remains required before merge. No paid service/API or billing setting is activated.

An initial browser timeout was a test-selector defect: Chromium labels a wrapping select with its option text, so an exact label failed while the real picker/contact were present. The test now targets the named contact select and still verifies the persisted contact ID; no mutation, tenant or persistence assertion was removed. Speculative changes to existing contact actions were removed. The Prisma relation explicitly maps the already committed composite FK name; no original migration was changed.

Browser results: the full run passed 13 groups including existing clinic/schedule/slot checks and the new opportunities flow, then timed out during late real calling-display signup (15 seconds; server recorded HTTP 200). Moving real display signup into fixture setup retained every authentication assertion/deadline, but the next complete attempt timed out on an existing no-JavaScript navigation. The full browser command therefore remains FAILED/blocked, not green. The unchanged exported callingBrowser then passed in a separate focused real-auth run against the twelve-table database, including registration, cross-screen SSE queue actions, tenant denial, privacy and revoked-display clearing, plus focused secret-log exclusion. No mutation, negative-request or navigation deadline was increased, and no case was skipped from the normal CI runner. Hosted CI and an uninterrupted full browser pass remain review gates.

Evidence directories: /tmp/bbd-opportunities-validation (115 unit/22 privilege/71 direct + 71 restricted migration-owner + 71 pooler; initial test-label failure and focused opportunities pass) and /tmp/bbd-opportunities-final (final build/HTTP; full browser attempts and focused calling pass). Earlier partial/focused runs are not presented as an uninterrupted full pass. Existing migration files, dependencies, contact actions and PR #6 source branch remain unchanged; the only new migration is the additive Opportunity table.
