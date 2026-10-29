# PR #6 security-focused review

Scope: original feature head cd88f7c6941a1920a5648be3e75d784a513a0046 against feat/clinic-slot-suggestions at 5fee593d487feae4f2f375f05e15bffc7259684d. Git transport independently confirmed refs/pull/6/head matched that feature commit. GitHub GraphQL remains Forbidden, so live comments, Draft status, check results and review decisions are not verified; Draft status is supplied by the owner. This automated source re-review does not replace the required independent human security review.

## Findings by severity

### Low — confirmed end-of-day editor defect, corrected

The schema permits 1440 minutes (24:00) as an end-of-day boundary and scheduleAllows correctly accepts an appointment ending exactly at midnight. The editor formatted 1440 as 24:00 but rendered it in input type=time; Chromium clears that invalid HTML time value. The POST parser also rejected 24:00. Thus a valid service-persisted schedule could not round-trip through the editor; ordinary edits failed validation. Reproduced with actual Chromium against the original time markup: inputValue was empty. This was a functional defect, not evidence of tenant access or conflict bypass.

Correction: end/break-end fields accept an explicit bounded HH:MM/24:00 text format. Shared server parsing permits 24:00 only for end boundaries; start/break-start remain ordinary time controls, and the existing schema still enforces quarter-hour intervals, day bounds, break containment and duration. No authorization, transaction, migration or runtime grant is broadened. Regression coverage adds parser/next-midnight unit cases and an actual schedule POST/persist/render browser assertion. Invalid 24:01, 25:00, malformed strings and 24:00 starts remain rejected.

### Medium operational risk — coordinated schema/grant/artifact rollout required

The ninth migration is additive and transactional, preserves existing NULL schedules and version zero, and changes no existing RLS policy or function. However, old application artifacts reject the new schedule UPDATE grants under their strict privilege contract. A staggered rollout or casual application-only rollback can cause readiness failures. Existing deployment documentation already identifies this limitation; no production rollout or blanket revoke is an acceptable fix. Human review must approve and rehearse cutover/rollback before deployment. This is an unresolved release gate, not a demonstrated privilege escalation in the reviewed application.

### Informational / acceptance boundaries

- Exact normalized Doctor resource matching governs schedule enforcement. NULL schedules and unregistered generic resource strings retain legacy booking behavior. This is explicit compatibility scope, not proof that all free-text practitioner aliases are mapped to a doctor. Staff must use registered resource labels; mandatory doctor IDs would be a separate product decision.
- Doctor metadata, including schedule dates, inherits the existing Doctor row SELECT policy, which includes DISPLAY context in the tenant. Application schedule services/pages reject DISPLAY and the board uses an explicit minimal projection that omits schedule/leave. No patient/leave reasons are stored. If database-level confidentiality of doctor schedules from DISPLAY context is required, the current metadata model needs a separate reviewed boundary; do not claim per-column RLS isolation.
- Audit events identify actor, tenant, action and doctor; they are not a full before/after schedule history or tamper-proof archive. Runtime audit rows remain append-only; migration owners remain privileged.
- A compromised application/runtime SQL credential can forge trusted actor settings under the documented base threat model. Transaction-stamped FORCE RLS protects missing ORM predicates and pool reuse, not arbitrary application compromise.

No confirmed critical/high-severity tenant, authorization or concurrent-booking bypass was established by this scoped review. This is not an exhaustive security certification.

## Boundary review

- Every new schedule mutation obtains requireSession in the Server Action helper and derives actor server-side. Browser org/doctor/day/version selectors are untrusted. Fresh membership and crm:write authorization occur in withOrganization before doctor/version checks; read excludes DISPLAY.
- Doctor lookup uses the composite tenant key; raw foreign-row UPDATE is denied by FORCE RLS. Existing tenant identity/resource UPDATE restrictions remain, and runtime grants add only schedule/scheduleVersion columns, never table-wide UPDATE, DELETE, TRUNCATE, ownership or bypass privileges.
- Schedule writes, optimistic version increments and audit inserts share the same scoped Prisma transaction and organization advisory lock as booking. No raw/global database connection is used inside callbacks. Pooler context remains transaction-local and stamped.
- Suggestions and direct booking/rescheduling share scheduleAllows; booking rereads current policy and lead/resource overlaps under that lock. Stale suggestions grant no reservation. Concurrent same-version edits produce one winner, and conflicting leave/booking cannot both commit. Existing durations are deliberately grandfathered; active hours/leave conflicts reject changes without cancelling records.
- The schedule update awaits audit inside the transaction; failures abort rather than silently succeeding. Server errors/logs expose safe categories, not submitted patient/credential data. Next origin/CSRF protections remain enabled; no anonymous webhook/new external API is introduced.
- Migration checks are not complete JSON validation; the application validates stored configurations and fails closed on malformed objects. Migration credentials are test/administration only; no production database was used.

## Browser timeout investigation

Saved failures were at three different cold development boundaries: manual booking click (15 seconds), an existing foreign-page GET/body (15 seconds), then first reception navigation (20 seconds). Earlier runs passed the new scheduling, slot, invitation and clinic assertions before the reception failure; focused calling passed separately. The unauthed synthetic warm-up followed sign-in redirects and did not guarantee full authenticated route readiness.

The current feature warms actual authenticated clinic/reception pages in a separate bounded setup phase, with a 60-second compile allowance. Mutation/negative HTTP assertions and their original deadlines remain unchanged. The review rerun uses this exact code and tests the whole suite rather than assuming a focused pass establishes a full pass. Next development logs show route compilation; a review-time resource sample showed active Next compilation CPU use, ample free memory and one loopback app listener. This supports a development compilation/test-setup timing explanation; it does not prove production cold-start performance or rule out all streaming defects.

Actual application defect: the midnight field round trip, reproduced independently of network latency and fixed above. Environmental/timing evidence: shifting cold-route timeouts without an authorization/data assertion failure. Final full-browser outcome is recorded below after completion; no deadline, CSRF, isolation or persistence assertion is disabled.

## Fresh validation

Local synthetic databases only; no resets, production credentials or external delivery. Logs: /tmp/bbd-pr6-review.

- Unit: 111 passed across seven files.
- Privilege: 22 passed.
- PostgreSQL integration: 66 passed directly, 66 under the separately authenticated restricted migration owner, 66 through actual transaction-mode PgBouncer.
- Migration history repeats without pending migrations; existing protected table/function ownership verified. No migration SQL changed during this review.
- Formatting, lint, typecheck, build and unchanged 819-package license inventory passed. Full/production npm audits report zero vulnerabilities at this snapshot.
- HTTP: passed, exit 0, including real authentication/verification, persisted organization/CRM/clinic actions, CSRF and cross-tenant denials.
- Chromium: the full suite passed uninterrupted, exit 0, all 14 PASS groups. This includes the new end-of-day save/render assertion, all schedule/slot flows, invitation transport, tenant/action denials, live cross-screen calling, revoked-display clearing and the complete fixture-secret log-exclusion check. Earlier focused passes were not substituted for this result.

No merge/deployment is authorized. Final human review must cover this correction, the unmerged ancestry, documented compatibility/data boundaries and release gates. Hosted CI must be checked separately; API access prevents an independent hosted-status claim here.

During the review rerun a read-only sample of pg_stat_activity in the isolated test database showed zero lock waits and zero idle-in-transaction sessions. This is a point-in-time observation, not a claim that contention is impossible. The uninterrupted pass supports the cold-development-compilation explanation for earlier timing failures; production cold starts, proxy streaming and load remain unverified. No test timing/security configuration was weakened in the review correction.

Recommendation: ready for independent human review of the final pushed SHA, not automatic merge or production approval. No critical/high bypass was confirmed. Human review must explicitly assess the medium operational rollout risk and informational compatibility/privacy boundaries above, and verify hosted CI when API access is available.
