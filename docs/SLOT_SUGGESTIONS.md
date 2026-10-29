# Clinic appointment slot suggestions

The doctor-schedules extension now applies configured weekly hours, breaks, leave and duration to this flow. See DOCTOR_SCHEDULES.md; the initial milestone's staff-selected-window fallback below now applies only to unconfigured doctors.

Branch: feat/clinic-slot-suggestions. Development base: feat/clinic-doctor-calling at da8ddb4e07f023a68469f1419c85e920cbc736f8. This feature does not change main, PR #4, migrations or Doctor Calling Display behavior. Independent human security review remains a release requirement.

## Behavior and reuse

The existing lead-detail booking card now offers a doctor selector and explicit search start/end in IST, plus duration. Existing Doctor resource labels, clinic time helpers, organization authorization/transactions, appointment statuses and booking actions remain authoritative. Manual booking remains available. No third-party workflow source, dependency, AI call, external API or provider integration is added.

Search values remain visible after validation errors and successful searches, allowing corrections/retries. Editing the doctor, time window or duration hides outdated suggestions until a fresh search completes.

The suggestion panel requires JavaScript/hydration; existing server-rendered manual booking remains the fallback. No public patient booking endpoint is added.

Doctors currently have no configured working-hours/roster records. Staff must choose a window agreed with the doctor; the UI states that suggestions are conflict-free candidates, not confirmed working hours or reservations. Configurable schedules are separate future work. Search is bounded to today through the next 30 days, one clinic day, at most eight hours; durations are 15–480 minutes in 15-minute steps. At most five future starts are returned on a 15-minute grid.

The new read service validates the selected lead and doctor within the current tenant, then queries all active doctor-resource OR lead conflicts overlapping the bounded window. It does not reuse the agenda's 100-record cap. Only start/end/resource values are returned, never other patients' names, phone numbers or appointment IDs. MEMBER may use the read service under existing read permissions, but the booking panel is shown only to writers. DISPLAY/nonmembers cannot read it.

Selecting a suggestion submits the existing authenticated booking Server Action. Under the organization advisory transaction lock, bookAppointment rechecks current membership, write permission, lead state, future start and all current resource/lead collisions before creating the appointment and audit event atomically. Submitted fields and prior suggestion state grant no authority. A stale selection or overlapping duplicate request is rejected. This is active-booking conflict protection, not a durable general-purpose idempotency receipt: a request replay after cancellation is not globally remembered.

## Review and test boundaries

Unit coverage tests quarter-hour/IST behavior, limits, invalid ranges, half-open boundaries, nested conflicts, elapsed starts, short/full windows. PostgreSQL integration adds foreign/dual-membership selectors, DISPLAY denial, MEMBER read/write separation, foreign booking isolation, more than 100 busy rows, lead conflicts on another resource, concurrent duplicates with one audit and revoked membership/lost lead/horizon denial. Synthetic administrative fixtures deliberately create overlapping rows to test full busy-query coverage; application mutations continue to use services.

The existing browser runner now includes invalid and empty windows, captured suggestion action replay under foreign cookies, a deliberately stale rendered suggestion, explicit successful booking and duplicate captured booking POST rejection. Existing invitation, clinic and calling-display checks remain enabled. Browser fixture creation is local synthetic setup, not a claim of an end-to-end doctor-registration flow in the new slot test; doctor UI already has its own calling regression.

Actual results and recovery failures are recorded in SLOT_SUGGESTIONS_VALIDATION.md. Passing local tests does not establish production readiness, provider pooler compatibility, load/accessibility compliance or an independent security approval.
