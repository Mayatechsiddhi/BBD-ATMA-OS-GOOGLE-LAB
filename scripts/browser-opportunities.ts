import assert from "node:assert/strict";
import type { Page, BrowserContext } from "playwright-core";
import { adminDb } from "./local-admin-db";
export async function opportunitiesBrowser(
  owner: Page,
  foreign: BrowserContext,
  member: Page,
  org: string,
  run: string,
) {
  const base = `/organizations/${org}/crm`;
  await owner.goto(`${base}/opportunities`, {
    waitUntil: "commit",
    timeout: 60000,
  });
  await owner
    .getByRole("heading", { name: "Opportunities", exact: true })
    .waitFor({ timeout: 60000 });
  await owner.goto(base, { waitUntil: "commit", timeout: 60000 });
  await owner
    .getByRole("heading", { name: "Client relationships", exact: true })
    .waitFor({ timeout: 60000 });
  const name = `Synthetic deal contact ${run}`;
  const title = `Synthetic service opportunity ${run}`;
  const email = `deal-ui-${run}@example.com`;
  await owner.getByLabel("Contact name", { exact: true }).fill(name);
  await owner.getByLabel("Email address", { exact: true }).fill(email);
  await owner.getByRole("button", { name: "Add lead", exact: true }).click();
  await owner.getByText(name, { exact: true }).waitFor();
  const contact = await adminDb.contact.findUniqueOrThrow({
    where: { organizationId_email: { organizationId: org, email } },
  });
  await owner.getByRole("link", { name: "Opportunities", exact: true }).click();
  await owner
    .getByRole("heading", { name: "Opportunities", exact: true })
    .waitFor();
  await owner.locator('select[name="contactId"]').selectOption(contact.id);
  await owner.getByLabel("Opportunity title", { exact: true }).fill(title);
  await owner
    .getByLabel("Estimated value (INR)", { exact: true })
    .fill("2500.05");
  const response = owner.waitForResponse(
    (r) =>
      r.request().method() === "POST" &&
      new URL(r.url()).pathname === `${base}/opportunities`,
  );
  await owner
    .getByRole("button", { name: "Create opportunity", exact: true })
    .click();
  const request = (await response).request();
  await owner.getByRole("heading", { name: title, exact: true }).waitFor();
  const deal = await adminDb.opportunity.findFirstOrThrow({
    where: { organizationId: org, title },
  });
  assert.equal(deal.amountPaise, 250005);
  assert.equal(deal.contactId, contact.id);
  const headers = await request.allHeaders();
  delete headers.cookie;
  delete headers.host;
  delete headers["content-length"];
  const repeated = await owner.context().request.post(request.url(), {
    headers,
    data: request.postDataBuffer()!,
    timeout: 20000,
    maxRedirects: 0,
  });
  assert.ok([200, 303].includes(repeated.status()));
  await repeated.body();
  assert.equal(
    await adminDb.opportunity.count({ where: { organizationId: org, title } }),
    1,
  );
  assert.equal(
    await adminDb.auditEvent.count({
      where: {
        organizationId: org,
        action: "crm.opportunity.created",
        subjectId: deal.id,
      },
    }),
    1,
  );
  const denied = await foreign.request.post(request.url(), {
    headers,
    data: request.postDataBuffer()!,
    timeout: 20000,
    maxRedirects: 0,
  });
  const body = await denied.text();
  const location =
    denied.headers().location ?? denied.headers()["x-action-redirect"] ?? "";
  assert.ok(
    denied.status() === 404 ||
      body.includes("Access denied") ||
      decodeURIComponent(location).includes("Access denied"),
  );
  const hidden = await foreign.request.get(`${base}/opportunities`, {
    maxRedirects: 0,
    timeout: 15000,
  });
  assert.equal(hidden.status(), 404);
  assert.ok(!(await hidden.text()).includes(title));
  await owner
    .getByRole("button", { name: "Move to proposal", exact: true })
    .click();
  await owner
    .getByRole("button", { name: "Move to won", exact: true })
    .waitFor();
  await owner.getByRole("button", { name: "Move to won", exact: true }).click();
  await owner
    .getByRole("button", { name: "Move to won", exact: true })
    .waitFor({ state: "detached" });
  assert.equal(
    (await adminDb.opportunity.findUniqueOrThrow({ where: { id: deal.id } }))
      .stage,
    "WON",
  );
  await owner
    .getByLabel("Search opportunities", { exact: true })
    .fill("does-not-match-synthetic");
  await owner
    .getByRole("button", { name: "Filter opportunities", exact: true })
    .click();
  await owner
    .getByText("No opportunities match these filters.", { exact: true })
    .waitFor();
  await member.goto(`${base}/opportunities`, { waitUntil: "commit" });
  await member.getByRole("heading", { name: title, exact: true }).waitFor();
  assert.equal(
    await member
      .getByRole("button", { name: "Create opportunity", exact: true })
      .count(),
    0,
  );
  console.log(
    "PASS opportunities browser real contact/create/stage workflow, exact INR persistence, duplicate POST idempotency, search, tenant denial and read-only membership",
  );
  return [
    name,
    title,
    email,
    encodeURIComponent(name),
    encodeURIComponent(title),
    encodeURIComponent(email),
  ];
}
