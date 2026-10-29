import assert from "node:assert/strict";
import type { BrowserContext, Page } from "playwright-core";
import { adminDb } from "./local-admin-db";
import { clinicDate, localInput } from "../src/modules/clinic/time";
import { slotsBrowser } from "./browser-slots";
export async function clinicBrowser({
  owner,
  foreign,
  member,
  org,
  run,
}: {
  owner: Page;
  foreign: BrowserContext;
  member: Page;
  org: string;
  run: string;
}) {
  const base = `/organizations/${org}/clinic`;
  // Compile the actual authenticated pages before timing mutations/negative HTTP
  // requests. Unauthenticated synthetic warm-up only compiled redirects.
  for (const [path, heading] of [
    ["", "Clinic dashboard"],
    ["/appointments", "Appointment agenda"],
    ["/follow-ups", "Follow-up tracker"],
    ["/schedules", "Doctor schedules"],
    ["/reception", "Reception & patient queues"],
  ]) {
    await owner.goto(base + path, { waitUntil: "commit", timeout: 60000 });
    await owner
      .getByRole("heading", { name: heading, exact: true })
      .waitFor({ timeout: 60000 });
  }
  await owner.goto(base + "/leads", { waitUntil: "commit" });
  await owner
    .getByLabel("Lead name", { exact: true })
    .fill(`Synthetic clinic lead ${run}`);
  await owner.getByLabel("Phone", { exact: true }).fill("+12025550101");
  await owner
    .getByRole("button", { name: "Add clinic lead", exact: true })
    .click();
  await owner.waitForURL(`**${base}/leads/*`, { waitUntil: "commit" });
  const leadPath = new URL(owner.url()).pathname;
  const leadId = leadPath.split("/").at(-1)!;
  assert.equal(
    (await adminDb.clinicLead.findUniqueOrThrow({ where: { id: leadId } }))
      .organizationId,
    org,
    "Clinic lead must persist in the current tenant",
  );
  await owner.getByLabel("Phone", { exact: true }).fill("+12025550102");
  await owner
    .getByRole("button", { name: "Save lead details", exact: true })
    .click();
  await owner.waitForURL(`**${base}/leads`, { waitUntil: "commit" });
  assert.equal(
    (await adminDb.clinicLead.findUniqueOrThrow({ where: { id: leadId } }))
      .phone,
    "+12025550102",
  );
  await owner.getByLabel("Search leads", { exact: true }).fill("+12025550102");
  await owner
    .getByRole("button", { name: "Filter leads", exact: true })
    .click();
  await owner.waitForFunction(
    () => new URL(location.href).searchParams.get("q") === "+12025550102",
  );
  await owner
    .getByRole("link", { name: `Synthetic clinic lead ${run}`, exact: true })
    .waitFor();
  await owner.goto(leadPath, { waitUntil: "commit" });
  await owner.getByRole("button", { name: "contacted", exact: true }).click();
  await owner.waitForURL(`**${base}/leads`, { waitUntil: "commit" });
  assert.equal(
    (await adminDb.clinicLead.findUniqueOrThrow({ where: { id: leadId } }))
      .status,
    "CONTACTED",
  );
  await owner.goto(leadPath, { waitUntil: "commit" });
  const start = new Date(Date.now() + 2 * 86400000),
    end = new Date(start.getTime() + 1800000);
  await owner.getByLabel("Practitioner or resource").fill("Synthetic Doctor");
  await owner
    .getByLabel("Start (IST)", { exact: true })
    .fill(localInput(start));
  await owner.getByLabel("End (IST)", { exact: true }).fill(localInput(end));
  const bookingResponse = owner.waitForResponse(
    (r) =>
      r.request().method() === "POST" && new URL(r.url()).pathname === leadPath,
  );
  await owner
    .getByRole("button", { name: "Book appointment", exact: true })
    .click();
  const booking = (await bookingResponse).request();
  await owner.waitForURL(`**${base}/appointments?day=${clinicDate(start)}`, {
    waitUntil: "commit",
  });
  await owner
    .getByRole("link", { name: `Synthetic clinic lead ${run}`, exact: true })
    .waitFor();
  const appointment = await adminDb.appointment.findFirstOrThrow({
    where: { organizationId: org, leadId },
  });
  assert.equal(
    appointment.startsAt.toISOString(),
    new Date(`${localInput(start)}:00+05:30`).toISOString(),
    "Booked instant must round-trip IST without timezone shifts",
  );
  await owner.getByRole("button", { name: "confirmed", exact: true }).click();
  await owner.waitForURL(`**${base}/appointments?day=${clinicDate(start)}`, {
    waitUntil: "commit",
  });
  await owner
    .getByRole("button", { name: "confirmed", exact: true })
    .waitFor({ state: "detached" });
  assert.equal(
    (
      await adminDb.appointment.findUniqueOrThrow({
        where: { id: appointment.id },
      })
    ).status,
    "CONFIRMED",
    "Confirmation must persist after the UI updates",
  );
  console.log(
    "PASS clinic browser lead creation, IST booking, agenda navigation and appointment confirmation",
  );

  // Re-send the browser's real bound booking action under another tenant's cookies.
  const before = await adminDb.appointment.count({
    where: { organizationId: org },
  });
  const headers = await booking.allHeaders();
  delete headers.cookie;
  delete headers.host;
  delete headers["content-length"];
  const denied = await foreign.request.post(booking.url(), {
    headers,
    data: booking.postDataBuffer()!,
    maxRedirects: 0,
    timeout: 20000,
  });
  assert.ok([200, 303, 404].includes(denied.status()));
  const responseBody = await denied.text();
  assert.ok(
    (
      denied.headers().location ??
      denied.headers()["x-action-redirect"] ??
      responseBody
    ).includes("permission") || denied.status() === 404,
  );
  assert.equal(
    await adminDb.appointment.count({ where: { organizationId: org } }),
    before,
  );
  for (const path of [
    base,
    base + "/leads",
    leadPath,
    base + "/appointments",
    base + "/follow-ups",
  ]) {
    const r = await foreign.request.get(path, { maxRedirects: 0 });
    assert.equal(r.status(), 404);
    assert.ok(!(await r.text()).includes(`Synthetic clinic lead ${run}`));
  }
  console.log(
    "PASS clinic browser cross-tenant pages and captured booking action denied without writes",
  );

  await owner.goto(leadPath, { waitUntil: "commit" });
  await owner.getByText("Reschedule appointment", { exact: true }).click();
  const reschedule = owner.locator("form").filter({
    has: owner.getByRole("button", { name: "Save reschedule", exact: true }),
  });
  const moved = new Date(start.getTime() + 86400000);
  await reschedule
    .getByLabel("Start (IST)", { exact: true })
    .fill(localInput(moved));
  await reschedule
    .getByLabel("End (IST)", { exact: true })
    .fill(localInput(new Date(moved.getTime() + 1800000)));
  await reschedule
    .getByRole("button", { name: "Save reschedule", exact: true })
    .click();
  await owner.waitForURL(`**${base}/appointments?day=${clinicDate(moved)}`, {
    waitUntil: "commit",
  });
  assert.equal(
    clinicDate(
      (
        await adminDb.appointment.findUniqueOrThrow({
          where: { id: appointment.id },
        })
      ).startsAt,
    ),
    clinicDate(moved),
  );
  await owner.getByRole("button", { name: "cancelled", exact: true }).click();
  await owner.waitForURL(`**${base}/appointments?day=${clinicDate(moved)}`, {
    waitUntil: "commit",
  });
  await owner
    .getByRole("button", { name: "cancelled", exact: true })
    .waitFor({ state: "detached" });
  assert.equal(
    (
      await adminDb.appointment.findUniqueOrThrow({
        where: { id: appointment.id },
      })
    ).status,
    "CANCELLED",
    "Cancellation must persist after the UI updates",
  );

  await owner.goto(leadPath, { waitUntil: "commit" });
  await owner
    .getByLabel("Follow-up task", { exact: true })
    .fill(`Synthetic follow-up ${run}`);
  await owner.getByLabel("Due (IST)", { exact: true }).fill(localInput(start));
  await owner
    .getByRole("button", { name: "Create follow-up", exact: true })
    .click();
  await owner.waitForURL(`**${base}/follow-ups`, { waitUntil: "commit" });
  await owner
    .getByText(`Synthetic follow-up ${run}`, { exact: true })
    .waitFor();
  await owner
    .getByRole("button", { name: "Complete follow-up", exact: true })
    .click();
  await owner
    .getByText("No follow-ups with this status.", { exact: true })
    .waitFor();
  const followUp = await adminDb.followUp.findFirstOrThrow({
    where: { organizationId: org, leadId },
  });
  assert.equal(followUp.status, "DONE");
  assert.ok(followUp.completedAt);
  await owner.goto(base, { waitUntil: "commit" });
  await owner
    .getByRole("heading", { name: "Clinic dashboard", exact: true })
    .waitFor();
  assert.ok((await owner.textContent("main"))?.includes("Active leads"));
  await slotsBrowser(owner, foreign, org, leadId, run);
  await member.goto(leadPath, { waitUntil: "commit" });
  await member
    .getByRole("heading", { name: `Synthetic clinic lead ${run}`, exact: true })
    .waitFor();
  assert.equal(
    await member
      .getByRole("button", { name: "Book appointment", exact: true })
      .count(),
    0,
  );
  assert.equal(
    await member
      .getByRole("button", { name: "Save lead details", exact: true })
      .count(),
    0,
  );
  console.log(
    "PASS clinic browser rescheduling/cancellation, persisted follow-up completion, dashboard and read-only member UI",
  );
  return [
    "+12025550102",
    encodeURIComponent("+12025550102"),
    `Synthetic clinic lead ${run}`,
    encodeURIComponent(`Synthetic clinic lead ${run}`),
  ];
}
