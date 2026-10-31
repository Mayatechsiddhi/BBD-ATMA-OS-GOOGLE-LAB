import { navigate } from "./browser-navigation";
import assert from "node:assert/strict";
import type { Page, BrowserContext } from "playwright-core";
import { adminDb } from "./local-admin-db";

export async function entitlementsBrowser(
  owner: Page,
  foreign: BrowserContext,
  member: Page,
  org: string,
) {
  const path = `/organizations/${org}/modules`;
  await navigate(owner, path, "entitlements-1", { waitUntil: "commit" });
  await owner
    .getByRole("heading", { name: "Platform modules", exact: true })
    .waitFor();
  assert.equal(
    await owner
      .getByRole("button", {
        name: /Enable ATMA|Enable AI agents|Enable Workflows/,
      })
      .count(),
    0,
  );
  await navigate(member, path, "entitlements-2", { waitUntil: "commit" });
  await member
    .getByRole("heading", { name: "Platform modules", exact: true })
    .waitFor();
  assert.equal(
    await member.getByRole("button", { name: /^(Enable|Disable) / }).count(),
    0,
  );
  const response = owner.waitForResponse(
    (r) =>
      r.request().method() === "POST" && new URL(r.url()).pathname === path,
  );
  await owner
    .getByRole("button", { name: "Disable Client relationships", exact: true })
    .click();
  const captured = (await response).request();
  await owner
    .getByRole("button", { name: "Enable Client relationships", exact: true })
    .waitFor();
  for (const suffix of ["/crm", "/crm/opportunities"])
    assert.equal(
      (
        await owner.context().request.get(`/organizations/${org}${suffix}`)
      ).status(),
      404,
    );
  const headers = await captured.allHeaders();
  delete headers.cookie;
  delete headers.host;
  delete headers["content-length"];
  for (const context of [foreign, member.context()]) {
    const denied = await context.request.post(captured.url(), {
      headers,
      data: captured.postDataBuffer()!,
      maxRedirects: 0,
      timeout: 15000,
    });
    const location =
      denied.headers().location ?? denied.headers()["x-action-redirect"] ?? "";
    assert.ok(denied.status() === 303 || denied.status() === 200);
    assert.ok(decodeURIComponent(location).includes("Access denied"));
    await denied.body();
  }
  assert.equal(
    (
      await adminDb.organizationModule.findUniqueOrThrow({
        where: {
          organizationId_moduleId: { organizationId: org, moduleId: "crm" },
        },
      })
    ).version,
    1,
  );
  await owner
    .getByRole("button", { name: "Enable Client relationships", exact: true })
    .click();
  await owner
    .getByRole("button", { name: "Disable Client relationships", exact: true })
    .waitFor();
  assert.equal(
    (await owner.context().request.get(`/organizations/${org}/crm`)).status(),
    200,
  );
  assert.equal(
    await adminDb.auditEvent.count({
      where: {
        organizationId: org,
        action: { in: ["module.crm.disabled", "module.crm.enabled"] },
      },
    }),
    2,
  );
  await owner
    .getByRole("button", { name: "Disable Clinic OS", exact: true })
    .click();
  await owner
    .getByRole("button", { name: "Enable Clinic OS", exact: true })
    .waitFor();
  assert.equal(
    (
      await owner.context().request.get(`/organizations/${org}/clinic`)
    ).status(),
    404,
  );
  assert.equal(
    (
      await owner
        .context()
        .request.get(`/api/organizations/${org}/calling?view=display`)
    ).status(),
    403,
  );
  await owner
    .getByRole("button", { name: "Enable Clinic OS", exact: true })
    .click();
  await owner
    .getByRole("button", { name: "Disable Clinic OS", exact: true })
    .waitFor();
  console.log(
    "PASS browser module owner toggle, disabled CRM/Clinic routes and calling SSE denial, member read-only controls, foreign/member action replay denial and audit",
  );
}
