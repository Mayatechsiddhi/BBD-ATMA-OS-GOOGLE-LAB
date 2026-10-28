# Clinic CRM Phase 1

This milestone extends the existing BBD application on feat/clinic-crm-mvp. It does not replace the general CRM or auth/tenancy foundation. No production access, deployment, new dependencies or third-party source import is required. All development/verification records are synthetic; the application is not populated with demo records.

## Working behavior

- **Leads:** name, normalized phone, optional normalized email, source (phone, walk-in, website, referral, other), status and timestamps. Shared family phone numbers are allowed. Create/edit records, search name/phone/email, filter by status and paginate 25 per page. Open a lead to book appointments and create follow-ups.
- **Lead lifecycle:** NEW → CONTACTED/QUALIFIED/LOST; CONTACTED → QUALIFIED/CONVERTED/LOST; QUALIFIED → CONVERTED/LOST. Converted/lost records are closed; no hard-delete or reopening workflow is exposed.
- **Appointments:** choose a lead, a consistent practitioner/resource label and start/end in IST. Book only future times, with positive duration up to eight hours. Overlapping active bookings for either the same normalized resource or the same lead are rejected; adjacent slots are allowed. Concurrent operations serialize on the existing organization transaction lock. Another tenant can independently use the same resource/time.
- **Appointment lifecycle:** SCHEDULED → CONFIRMED/CHECKED_IN/CANCELLED/NO_SHOW; CONFIRMED → CHECKED_IN/CANCELLED/NO_SHOW; CHECKED_IN → COMPLETED/CANCELLED. Terminal states cannot be reversed. Check-in/completion/no-show require the start time to have arrived. Scheduled/confirmed appointments can be rescheduled with the same overlap checks. Lost leads cannot receive new appointments. Successful appointment changes open the affected clinic day's agenda.
- **Follow-ups:** an administrative task title, lead and due time. Create/edit open tasks for future due times, complete or cancel them. Overdue means OPEN and due before now. DONE records receive completedAt; cancelled tasks do not. Closed tasks cannot be edited/reopened. No automatic email, SMS or WhatsApp is sent.
- **Dashboard:** active lead count and counts by pipeline stage, non-cancelled appointments starting today, open/overdue follow-ups and the next ten active future appointments. Counts are database-derived for the current tenant.

The agenda shows up to 100 appointments overlapping a selected clinic day; task views show the earliest 100 per status; lead detail shows the latest 50 appointments/follow-ups. These bounds are explicit. Larger calendars/history need further pagination. Dates are fixed to Asia/Kolkata in Phase 1, persisted as UTC instants using timestamptz; browser timezone does not determine stored time.

## Security and persistence

ClinicLead, Appointment and FollowUp each have organizationId, scoped keys, indexes and FORCE RLS. Children have composite tenant/lead foreign keys. The runtime role has SELECT/INSERT and specified mutable-column UPDATE privileges, without DELETE or tenant/lead reassignment. It cannot inherit/own migration objects or bypass RLS. Runtime readiness and the integration inventory now require all eight tenant tables to be protected.

Every action obtains the server session, validates submitted values and calls scoped services. Permission checks, clinic mutations and audit inserts share a Prisma transaction with the existing transaction-local context and organization lock. Owners/admins write through crm:write; members read only. Cross-tenant page requests return 404; unauthorized writes fail without persistence or audit side effects. No clinical notes, diagnoses, medications, documents, medical history or billing data are modeled. Clinic URLs are excluded from development request logs because search parameters can contain contact details; production ingress/logging still needs its own redaction and retention configuration.

RLS trusts server actor context and is not a defense against arbitrary SQL execution or stolen credentials. Migration owners remain privileged. Future booking and lifecycle/overlap checks are service rules; database CHECK constraints enforce interval shape and follow-up completion consistency, not a full scheduling engine. A free-text practitioner label is not an immutable clinician identity; aliases can represent the same person. Use consistent labels and review a practitioner/room directory before a broader pilot.

## Migration and rollout

The new 202610270001_clinic_crm migration is additive and transactional. All previous migrations remain byte-for-byte unchanged. It creates three enums, three tables, scoped indexes/foreign keys/CHECK constraints and tenant policies using the existing private context helpers. It adds no extension or privileged function. Runtime grants are explicit in the local provisioning helper; production grants need independent review with the same column restrictions.

For local development, preserve .env and volumes, generate Prisma, apply migrations, rerun local runtime grants and prepare the separate test database. Apply the complete schema/grants before starting the new runtime, which fails closed if the clinic RLS inventory is missing. Never reset a database to apply this milestone. The fresh migration test uses a new bbd_clinic_migration_test database with the existing separately authenticated restricted migration owner; earlier test databases and credentials remain intact. It applies twice and runs the integration suite.

## Remaining product and release work

Independent review, staging migration/grant checks, actual provider TLS/pooling, production SMTP, backup/restore and existing auth/security gates remain required. Phase 1 is not a production readiness signoff. A practitioner/room directory, clinic-specific hours/timezones, granular reception roles, consent and retention workflows, recurring appointments, reminder outbox, billing and patient self-service remain future work. No calendar provider, external communication or paid infrastructure is connected.

Tracked follow-up: paginate agendas/follow-ups past 100 and lead-detail history past 50. Acceptance requires deterministic, tenant-scoped navigation and regression fixtures exceeding those limits; no records beyond the current caps should be represented as already browsable. See ROADMAP.md.
