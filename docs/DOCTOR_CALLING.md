# Clinic reception and doctor calling

This feature extends clinic Phase 1 on `feat/clinic-doctor-calling`, based on foundation commit 9370de3d0618cdeab899e3ca32d1f9a53b0622ae. PR #4 remains a separate Draft awaiting independent human security review. No merge, production access, deployment or external messaging is performed.

## Reuse and source review

Reuse: Better Auth and database sessions; `withOrganization` and its transaction/advisory lock; append-only audit; runtime privilege contract; clinic lead/appointment validation and lifecycle; Asia/Kolkata conversion; original local UI primitives and real PostgreSQL/Prisma persistence. No replacement app, copied queue product, proprietary plugin or new package was added. Existing installed LICENSE files/metadata were re-read: Next 16.4.2, React 19.3.1, Better Auth 1.7.11, Radix 1.8.1, Zod 4.6.7 and pg 8.23.1 use MIT; class-variance-authority 0.7.1 and Prisma client 7.10.1 use Apache-2.0. Playwright core 1.64.1 test tooling uses Apache-2.0. These permissive licenses allow commercial use subject to notices/terms; prior transitive LGPL/MPL and artifact obligations in SOURCE_AND_LICENSE_AUDIT.md remain applicable. Native EventSource/Web Streams provide transport without an external service.

## Staff workflow

Open Clinic → Reception & calling. Register an administrative patient contact, register an existing clinic lead, or issue a token from today's active appointment (which registers/reuses its patient atomically). Registration references ClinicLead rather than copying name/phone data into a second profile. Shared phone numbers are allowed; search before registration. No diagnosis, medical chart, birth date, prescription, payment or clinical-note fields are introduced.

Create a doctor queue with name, room and an immutable normalized appointment-resource label. Appointment token conversion requires the matching resource and an active appointment starting on the current IST day. Patient/doctor/appointment IDs are authorized tenant selectors, never actor identity. Doctor names/rooms can be edited, with an audited live revision change. This milestone allows at most 50 doctor records per organization; archiving/rosters are future work.

Token numbers are unique across the clinic's IST day (not separately numbered per doctor), allocated under the existing organization transaction lock. Numbers reset by day and are never reused after cancellation. Doctor-wise queues allow call, recall, skip, complete and cancel. One CALLED token per doctor/day is enforced by a partial unique index. Only CALLED tokens can be recalled/completed; skipped tokens can be called again. Completed/cancelled tokens cannot be reopened. Cancelled visits can receive a fresh number; partial unique indexes prevent multiple non-cancelled tokens for a patient/doctor/day or appointment while retaining cancelled history. A completed visit still counts toward the patient/doctor/day uniqueness rule.

Calling/recalling a linked appointment validates its active state; check-in cannot occur before its scheduled start. Call and completion synchronize appointment status/audit atomically. Existing appointment cancellation, no-show or completion closes its active token. Rescheduling requires cancellation of an active token first; cancelled history does not prevent rescheduling or reissuance. Past-day calls/recalls are denied, but authorized staff can select a past day and close unfinished work. Queue cancellation alone does not cancel the appointment.

Patient search is paginated 25 per page and reception tokens 50 per page, with doctor/day filtering. The existing appointment-to-token picker shows up to 100 eligible appointments today; its expansion remains tracked with the older clinic agenda/follow-up/history limits. No unreachable records are claimed visible beyond that picker cap.

## Permissions and privacy

| Role                   | Patient/reception data | Queue/doctor writes | Calling display |
| ---------------------- | ---------------------- | ------------------- | --------------- |
| OWNER / ADMIN          | Read                   | Yes                 | Yes             |
| MEMBER                 | Read                   | No                  | Yes             |
| DISPLAY                | Denied                 | Denied              | Yes             |
| Nonmember / signed out | Denied                 | Denied              | Denied          |

Use a separate verified DISPLAY account for a waiting-room device, invited through the existing private invitation flow. Do not leave a privileged staff session on that device. Workspace selection routes DISPLAY membership to `/display/[organizationId]`. The dedicated display avoids the staff layout/account header and emits token numbers, call count, doctor name/room and day only. It emits no patient name, phone, patient/lead/appointment ID or queue-token ID. Doctor identifiers are present for card identity; revision metadata identifies doctor records only. Do not put patient information into doctor/room labels. Full-screen browser/kiosk management and device/session administration remain operational work.

New Patient, Doctor and QueueToken records have FORCE RLS and tenant keys. Composite foreign keys bind token patient/lead/appointment/doctor consistently within one tenant. Runtime grants prohibit deleting/reassigning patients/tokens or changing doctor resource keys. DISPLAY is excluded from private patient, clinic, contact and audit read policies; only own membership discovery, organization discovery, doctor and queue rows are available under the relevant policy context. The display service projects a minimal payload, not raw queue rows. Global authentication remains trusted as documented in TENANT_ISOLATION.md. Audit insertion does not request RETURNING rows, so accepting a display invitation can append its audit event without granting private audit SELECT.

Actions authenticate independently, validate input, authorize membership inside the same transaction, serialize queue mutations and commit audit/revision changes together. React escapes labels. Native Server Action CSRF/origin checks remain enabled. Clinic/search, display and live endpoint URLs are excluded from development request tracing; production ingress redaction and retention still need review. No PHI is placed in event URLs, event IDs, browser storage or query parameters on display screens.

## Live transport

`GET /api/organizations/[organizationId]/calling` is authenticated SSE with private/no-store/no-transform headers. Missing sessions receive 401, foreign membership 403. Each stream sends a database snapshot approximately every two seconds, rechecking session and membership each time; `view=reception` requires staff read permission, while `view=display` uses display permission. Reception revisions include the current staff role so demotion refreshes write controls, and a change to DISPLAY closes the staff stream. No transaction/connection is held between ticks. A doctor revision counter commits with queue changes and allows other reception screens to refresh without manual reload. PostgreSQL is authoritative across instances; there is no in-process-only event bus.

Streams close after about 30 seconds and EventSource reconnects. Transport errors or revocation clear display cards; missing heartbeats also clear them after seven seconds. Reconnects can briefly show the unavailable banner. This is near-real-time polling over SSE, not an instant push guarantee. Proxy buffering, request timeouts, connection limits, background-tab behavior, database load and multi-instance capacity require staging/load tests. Stream resource quotas, distributed abuse protection and an event/outbox broker are future hardening; no public/anonymous display or pairing secret is enabled.

## Migration and release gates

Three additive feature migrations preserve all committed foundation migrations. The enum addition commits before DISPLAY is used; subsequent migrations add/narrow policies, create three tables and partial indexes, and permit cancelled-token reissuance without deleting history. Readiness/integration inventory now requires all eleven tenant tables; the shared privilege allowlist includes the reviewed new column grants. Apply the complete chain and reviewed grants only in an approved environment. Local validation uses isolated `_test` databases.

A foundation runtime with the previous strict privilege contract can reject the new table grants. A real rollout therefore needs coordinated artifact/grant cutover and reviewed rollback privileges, not an assumption that old workers can coexist with arbitrary new grants. Never blindly revoke privileges or reset a database. No production rollout, down migration or automated rollback is authorized by this feature.

Independent human review of the foundation and new role/RLS/migrations remains required. Provider TLS/pooling, production SMTP, backups/restore, MFA/session administration, consent/retention policy, granular staff/doctor assignments, accessibility/mobile/device testing and performance gates remain open. This feature is not a production-readiness or clinical-system certification. See DOCTOR_CALLING_VALIDATION.md for actual checks and failures.
