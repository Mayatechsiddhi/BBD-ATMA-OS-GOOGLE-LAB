import { navigate } from "./browser-navigation";
import assert from "node:assert/strict";
import type { Page, BrowserContext } from "playwright-core";
import { adminDb } from "./local-admin-db";
import { clinicDate } from "../src/modules/clinic/time";
import { scheduleBrowser } from "./browser-schedules";

export async function slotsBrowser(
  owner: Page,
  foreign: BrowserContext,
  org: string,
  leadId: string,
  run: string,
) {
  const doctor = await adminDb.doctor.create({
    data: {
      organizationId: org,
      name: `Synthetic slot doctor ${run}`,
      room: "S1",
      resource: `slot-${run}`,
    },
  });
  const path = `/organizations/${org}/clinic/leads/${leadId}`;
  const day = clinicDate(new Date(Date.now() + 5 * 86400000));
  const open = async () => {
    await navigate(owner, path, "slots-1", { waitUntil: "commit" });
    const panel = owner.getByRole("region", {
      name: "Appointment suggestions",
    });
    await panel.locator('form[data-hydrated="true"]').waitFor();
    await panel.getByLabel("Suggestion doctor").selectOption(doctor.id);
    await panel.getByLabel("Search start (IST)").fill(`${day}T09:00`);
    await panel.getByLabel("Search end (IST)").fill(`${day}T11:00`);
    return panel;
  };
  let panel = await open();
  await panel.getByLabel("Search end (IST)").fill(`${day}T08:00`);
  await panel.getByRole("button", { name: "Find slots", exact: true }).click();
  await panel
    .getByRole("alert")
    .getByText("Choose a valid doctor, window and duration.")
    .waitFor();
  assert.equal(
    await panel.getByLabel("Search start (IST)").inputValue(),
    `${day}T09:00`,
    "Validation must preserve the search window for correction",
  );
  assert.equal(
    await panel.getByLabel("Suggestion doctor").inputValue(),
    doctor.id,
  );
  await panel.getByLabel("Search end (IST)").fill(`${day}T11:00`);
  console.log(
    "CHECK slots: invalid window rejected; request valid suggestions",
  );
  const response = owner.waitForResponse(
    (r) =>
      r.request().method() === "POST" && new URL(r.url()).pathname === path,
  );
  await panel.getByRole("button", { name: "Find slots", exact: true }).click();
  const request = (await response).request();
  await panel
    .getByRole("button", { name: /Book suggested slot:/ })
    .first()
    .waitFor();
  assert.equal(
    await panel.getByRole("button", { name: /Book suggested slot:/ }).count(),
    5,
  );
  const headers = await request.allHeaders();
  delete headers.cookie;
  delete headers.host;
  delete headers["content-length"];
  const denied = await foreign.request.post(request.url(), {
    headers,
    data: request.postDataBuffer()!,
    timeout: 20000,
    maxRedirects: 0,
  });
  assert.ok((await denied.text()).includes("Access denied"));
  await panel.getByLabel("Duration (minutes)").fill("45");
  await panel
    .getByRole("button", { name: /Book suggested slot:/ })
    .first()
    .waitFor({ state: "detached" });
  assert.equal(
    await panel.getByRole("button", { name: /Book suggested slot:/ }).count(),
    0,
    "Editing a search must hide outdated suggestions",
  );
  await panel.getByLabel("Duration (minutes)").fill("30");
  await panel.getByRole("button", { name: "Find slots", exact: true }).click();
  await panel
    .getByRole("button", { name: /Book suggested slot:/ })
    .first()
    .waitFor();
  console.log(
    "CHECK slots: five suggestions and foreign action denial verified",
  );
  // Another reception booking makes the rendered first suggestion stale.
  const busy = await adminDb.appointment.create({
    data: {
      organizationId: org,
      leadId,
      resource: doctor.resource,
      startsAt: new Date(`${day}T09:00:00+05:30`),
      endsAt: new Date(`${day}T11:00:00+05:30`),
    },
  });
  await panel
    .getByRole("button", { name: /Book suggested slot:/ })
    .first()
    .click();
  await owner
    .getByText(
      "That lead or practitioner already has an overlapping appointment.",
      { exact: true },
    )
    .waitFor();
  assert.equal(
    await adminDb.appointment.count({
      where: { organizationId: org, resource: doctor.resource },
    }),
    1,
  );
  panel = await open();
  await panel.getByRole("button", { name: "Find slots", exact: true }).click();
  await panel
    .getByText("No available slots in this window.", { exact: true })
    .waitFor();
  await adminDb.appointment.delete({ where: { id: busy.id } });
  console.log(
    "CHECK slots: stale booking and empty window verified; request fresh suggestions",
  );
  await panel.getByRole("button", { name: "Find slots", exact: true }).click();
  await panel
    .getByRole("button", { name: /Book suggested slot:/ })
    .first()
    .waitFor();
  const bookedResponse = owner.waitForResponse(
    (r) =>
      r.request().method() === "POST" && new URL(r.url()).pathname === path,
  );
  await panel
    .getByRole("button", { name: /Book suggested slot:/ })
    .first()
    .click();
  const booking = (await bookedResponse).request();
  await owner.waitForURL(`**/appointments?day=${day}`, { waitUntil: "commit" });
  await owner
    .getByRole("heading", { name: "Appointment agenda", exact: true })
    .waitFor();
  const bookingHeaders = await booking.allHeaders();
  delete bookingHeaders.cookie;
  delete bookingHeaders.host;
  delete bookingHeaders["content-length"];
  const repeated = await owner.context().request.post(booking.url(), {
    headers: bookingHeaders,
    data: booking.postDataBuffer()!,
    timeout: 20000,
    maxRedirects: 0,
  });
  assert.ok(
    (await repeated.text()).includes("overlapping") ||
      (
        repeated.headers()["x-action-redirect"] ??
        repeated.headers().location ??
        ""
      ).includes("overlapping"),
  );
  assert.equal(
    await adminDb.appointment.count({
      where: { organizationId: org, resource: doctor.resource },
    }),
    1,
  );
  console.log(
    "PASS slot suggestions browser invalid/empty windows, cross-tenant action denial, stale conflict rejection, explicit booking and duplicate POST rejection",
  );
  await scheduleBrowser(owner, foreign, org, doctor.id, leadId, day);
}
