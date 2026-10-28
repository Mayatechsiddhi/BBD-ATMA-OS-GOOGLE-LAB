import assert from "node:assert/strict";
import type { BrowserContext, Page } from "playwright-core";
import { adminDb } from "./local-admin-db";
import * as orgs from "../src/modules/organizations/service";
export async function callingBrowser({
  owner,
  foreign,
  screen,
  org,
  actor,
  screenUser,
  run,
}: {
  owner: Page;
  foreign: BrowserContext;
  screen: Page;
  org: string;
  actor: string;
  screenUser: string;
  run: string;
}) {
  const base = `/organizations/${org}/clinic/reception`;
  const invitation = await orgs.createInvitation(actor, org, {
    email: (await adminDb.user.findUniqueOrThrow({ where: { id: screenUser } }))
      .email,
    role: "DISPLAY",
  });
  await orgs.acceptInvitation(screenUser, invitation);
  await owner.goto(base, { waitUntil: "commit" });
  await owner.getByText(/Live queue connected/).waitFor();
  const doctorForm = owner.locator("form").filter({
    has: owner.getByRole("button", { name: "Add doctor queue", exact: true }),
  });
  await doctorForm
    .getByLabel("Doctor name", { exact: true })
    .fill(`Synthetic calling doctor ${run}`);
  await doctorForm.getByLabel("Room", { exact: true }).fill("C1");
  await doctorForm
    .getByLabel("Appointment resource label")
    .fill(`calling-${run}`);
  await doctorForm
    .getByRole("button", { name: "Add doctor queue", exact: true })
    .click();
  await owner
    .getByText(`Synthetic calling doctor ${run} · Room C1`, { exact: true })
    .waitFor();
  const doctor = await adminDb.doctor.findFirstOrThrow({
    where: { organizationId: org, resource: `calling-${run}` },
  });
  const name = `Synthetic private patient ${run}`;
  const patientForm = owner.locator("form").filter({
    has: owner.getByRole("button", { name: "Register patient", exact: true }),
  });
  await patientForm.getByLabel("Lead name", { exact: true }).fill(name);
  await patientForm.getByLabel("Phone", { exact: true }).fill("+12025550103");
  await patientForm
    .getByRole("button", { name: "Register patient", exact: true })
    .click();
  await owner.getByText(`${name} · +12025550103`, { exact: true }).waitFor();
  const observer = await owner.context().newPage();
  await observer.goto(base, { waitUntil: "commit" });
  await observer.getByText(/Live queue connected/).waitFor();
  const initialStream = await screen.evaluate(async (path) => {
    const abort = new AbortController();
    const timeout = setTimeout(() => abort.abort(), 15000);
    try {
      const response = await fetch(path, { signal: abort.signal });
      if (response.status !== 200)
        return { status: response.status, doctors: [] as string[] };
      const reader = response.body!.getReader();
      let text = "";
      const decoder = new TextDecoder();
      while (!text.includes("\n\n")) {
        const chunk = await reader.read();
        if (chunk.done) break;
        text += decoder.decode(chunk.value, { stream: true });
      }
      await reader.cancel();
      const payload = JSON.parse(
        text
          .split("\n")
          .find((line) => line.startsWith("data: "))!
          .slice(6),
      );
      return {
        status: response.status,
        doctors: payload.doctors.map((d: { id: string }) => d.id),
      };
    } finally {
      clearTimeout(timeout);
      abort.abort();
    }
  }, `/api/organizations/${org}/calling?view=display`);
  assert.equal(
    initialStream.status,
    200,
    "Display-only session must open an authenticated SSE snapshot",
  );
  assert.ok(
    initialStream.doctors.includes(doctor.id),
    "Display snapshot must include the tenant doctor",
  );
  await screen.goto(`/display/${org}`, { waitUntil: "commit" });
  await screen
    .getByRole("article", { name: doctor.name, exact: true })
    .waitFor({ timeout: 60000 });
  const walkin = owner.locator("article").filter({ hasText: name });
  await walkin.getByLabel("Doctor for walk-in").selectOption(doctor.id);
  await walkin.getByRole("button", { name: "Issue walk-in token" }).click();
  const patient = await adminDb.patient.findFirstOrThrow({
    where: { organizationId: org, lead: { name } },
  });
  // Wait for the persisted token and its returned reception row before actions.
  await owner.getByRole("cell", { name: "waiting", exact: true }).waitFor();
  const token = await adminDb.queueToken.findFirstOrThrow({
    where: { organizationId: org, patientId: patient.id },
  });
  await observer.getByTestId(`token-${token.id}`).waitFor();
  const row = () => owner.getByTestId(`token-${token.id}`);
  const callingResponse = owner.waitForResponse(
    (r) =>
      r.request().method() === "POST" && new URL(r.url()).pathname === base,
  );
  await row().getByRole("button", { name: "call", exact: true }).click();
  await screen
    .getByTestId(`calling-${doctor.id}`)
    .filter({ hasText: String(token.number).padStart(3, "0") })
    .waitFor();
  const captured = (await callingResponse).request();
  const replayHeaders = await captured.allHeaders();
  delete replayHeaders.cookie;
  delete replayHeaders.host;
  delete replayHeaders["content-length"];
  for (const context of [foreign, screen.context()]) {
    const response = await context.request.post(captured.url(), {
      headers: replayHeaders,
      data: captured.postDataBuffer()!,
      maxRedirects: 0,
      timeout: 20000,
    });
    assert.ok([200, 303, 404].includes(response.status()));
    const denial =
      response.headers().location ??
      response.headers()["x-action-redirect"] ??
      (await response.text());
    assert.ok(
      decodeURIComponent(denial.replaceAll("+", " ")).includes(
        "Access denied.",
      ),
    );
    assert.equal(
      (await adminDb.queueToken.findUniqueOrThrow({ where: { id: token.id } }))
        .callCount,
      1,
    );
  }
  await row().getByRole("button", { name: "recall", exact: true }).click();
  await screen.getByText("Call 2", { exact: true }).waitFor();
  await screen.setViewportSize({ width: 390, height: 844 });
  assert.ok(
    await screen.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
    "Calling display must fit a phone viewport",
  );
  await screen.setViewportSize({ width: 1280, height: 800 });
  const html = await screen.content();
  for (const secret of [name, "+12025550103", patient.id])
    assert.ok(
      !html.includes(secret),
      "Display must not expose patient identity",
    );
  assert.equal(
    (await foreign.request.get(`/api/organizations/${org}/calling`)).status(),
    403,
  );
  assert.equal(
    (
      await screen.request.get(
        `/api/organizations/${org}/calling?view=reception`,
      )
    ).status(),
    403,
  );
  const denied = await screen.request.get(base);
  assert.equal(denied.status(), 404);
  assert.ok(!(await denied.text()).includes(name));
  await row().getByRole("button", { name: "skip", exact: true }).click();
  await screen
    .getByTestId(`calling-${doctor.id}`)
    .filter({ hasText: "—" })
    .waitFor();
  await row().getByRole("button", { name: "call", exact: true }).click();
  await screen.getByText("Call 3", { exact: true }).waitFor();
  await row().getByRole("button", { name: "complete", exact: true }).click();
  await screen
    .getByTestId(`calling-${doctor.id}`)
    .filter({ hasText: "—" })
    .waitFor();
  assert.equal(
    (await adminDb.queueToken.findUniqueOrThrow({ where: { id: token.id } }))
      .status,
    "COMPLETED",
  );
  await orgs.changeMember(actor, org, screenUser, null);
  await screen
    .getByText(
      "Connecting or access unavailable. Calls are hidden until the live connection is restored.",
      { exact: true },
    )
    .waitFor();
  assert.equal(await screen.getByRole("article").count(), 0);
  await observer.close();
  console.log(
    "PASS calling browser registration, doctor queue, cross-screen SSE call/recall/skip/complete, patient privacy, foreign stream denial and revoked display clearing",
  );
  return [
    name,
    encodeURIComponent(name),
    "+12025550103",
    encodeURIComponent("+12025550103"),
  ];
}
