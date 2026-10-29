import assert from "node:assert/strict";
import type { Page, BrowserContext } from "playwright-core";
import { adminDb } from "./local-admin-db";
import { clinicDate } from "../src/modules/clinic/time";
export async function scheduleBrowser(
  owner: Page,
  foreign: BrowserContext,
  org: string,
  doctorId: string,
  leadId: string,
  day: string,
) {
  const path = `/organizations/${org}/clinic/schedules`;
  await owner.goto(path, { waitUntil: "commit" });
  await owner
    .getByRole("heading", { name: "Doctor schedules", exact: true })
    .waitFor();
  const form = owner
    .locator("form")
    .filter({
      has: owner.locator(`input[name="doctorId"][value="${doctorId}"]`),
    })
    .filter({
      has: owner.getByRole("button", {
        name: "Save working hours",
        exact: true,
      }),
    });
  for (const weekday of [
    "Sunday",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
  ]) {
    const fields = form.getByRole("group", { name: weekday, exact: true });
    await fields.getByLabel("Open", { exact: true }).check();
    await fields
      .getByLabel("Break start (optional)", { exact: true })
      .fill("12:00");
    await fields
      .getByLabel("Break end (optional)", { exact: true })
      .fill("13:00");
  }
  const response = owner.waitForResponse(
    (r) =>
      r.request().method() === "POST" && new URL(r.url()).pathname === path,
  );
  await form
    .getByRole("button", { name: "Save working hours", exact: true })
    .click();
  const request = (await response).request();
  await owner.getByText("Schedule saved.", { exact: true }).waitFor();
  assert.equal(
    (await adminDb.doctor.findUniqueOrThrow({ where: { id: doctorId } }))
      .scheduleVersion,
    1,
  );
  const headers = await request.allHeaders();
  delete headers.cookie;
  delete headers.host;
  delete headers["content-length"];
  const denied = await foreign.request.post(request.url(), {
    headers,
    data: request.postDataBuffer()!,
    maxRedirects: 0,
    timeout: 20000,
  });
  const body = await denied.text();
  const location =
    denied.headers().location ?? denied.headers()["x-action-redirect"] ?? "";
  assert.ok(
    denied.status() === 404 ||
      body.includes("Access denied") ||
      decodeURIComponent(location).includes("Access denied"),
  );
  assert.equal(
    (await adminDb.doctor.findUniqueOrThrow({ where: { id: doctorId } }))
      .scheduleVersion,
    1,
  );
  await owner.getByLabel("Leave date (IST)").fill(day);
  await owner.getByRole("button", { name: "Add leave", exact: true }).click();
  await owner
    .getByText(
      "This change conflicts with an active appointment. Reschedule or cancel it first.",
      { exact: true },
    )
    .waitFor();
  const leave = clinicDate(new Date(Date.now() + 6 * 86400000));
  await owner.getByLabel("Leave date (IST)").fill(leave);
  await owner.getByRole("button", { name: "Add leave", exact: true }).click();
  await owner
    .getByRole("button", { name: `Remove leave ${leave}`, exact: true })
    .waitFor();
  await owner.goto(`/organizations/${org}/clinic/leads/${leadId}`, {
    waitUntil: "commit",
  });
  const panel = owner.getByRole("region", { name: "Appointment suggestions" });
  await panel.locator('form[data-hydrated="true"]').waitFor();
  await panel.getByLabel("Suggestion doctor").selectOption(doctorId);
  assert.equal(await panel.getByLabel("Duration (minutes)").inputValue(), "30");
  assert.equal(
    await panel.getByLabel("Duration (minutes)").isEditable(),
    false,
  );
  await panel.getByLabel("Search start (IST)").fill(`${day}T12:00`);
  await panel.getByLabel("Search end (IST)").fill(`${day}T13:00`);
  await panel.getByRole("button", { name: "Find slots", exact: true }).click();
  await panel
    .getByText("No available slots in this window.", { exact: true })
    .waitFor();
  await panel.getByLabel("Search start (IST)").fill(`${leave}T09:00`);
  await panel.getByLabel("Search end (IST)").fill(`${leave}T11:00`);
  const leaveResponse = owner.waitForResponse(
    (r) =>
      r.request().method() === "POST" &&
      new URL(r.url()).pathname ===
        `/organizations/${org}/clinic/leads/${leadId}`,
  );
  await panel.getByRole("button", { name: "Find slots", exact: true }).click();
  await leaveResponse;
  await panel
    .getByRole("button", { name: "Find slots", exact: true })
    .waitFor({ state: "visible" });
  // Wait for the action response, not the previous empty state, before inspecting leave output.
  await panel
    .getByText("No available slots in this window.", { exact: true })
    .waitFor();
  assert.equal(
    await panel.getByRole("button", { name: /Book suggested slot:/ }).count(),
    0,
  );
  await owner.goto(path, { waitUntil: "commit" });
  const removed = owner.waitForResponse(
    (r) =>
      r.request().method() === "POST" && new URL(r.url()).pathname === path,
  );
  await owner
    .getByRole("button", { name: `Remove leave ${leave}`, exact: true })
    .click();
  await removed;
  await owner.getByText("Schedule saved.", { exact: true }).waitFor();
  assert.equal(
    (await adminDb.doctor.findUniqueOrThrow({ where: { id: doctorId } }))
      .scheduleVersion,
    3,
  );
  console.log(
    "PASS schedules browser weekly hours/breaks, fixed duration, leave add/remove, booking conflict preservation and cross-tenant POST denial",
  );
}
