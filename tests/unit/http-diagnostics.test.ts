import { expect, it } from "vitest";
import { diagnoseHttpRequest } from "../../scripts/http-diagnostics";
it("records ordered dispatch/headers stages without private paths or response contents", async () => {
  const lines: string[] = [];
  const response = new Response("private-response", { status: 403 });
  expect(
    await diagnoseHttpRequest(
      "POST",
      "/organizations/private-tenant/invitations?token=secret-token",
      async () => response,
      (line) => lines.push(line),
    ),
  ).toBe(response);
  const events = lines.map((line) => JSON.parse(line));
  expect(events.map((event) => event.stage)).toEqual(["dispatch", "headers"]);
  expect(events[1]).toMatchObject({
    method: "POST",
    route: "/organizations/:id/invitations",
    status: 403,
  });
  expect(lines.join()).not.toMatch(
    /private-tenant|secret-token|private-response/,
  );
});
it("preserves the original timeout and logs no error message, cause or arbitrary verb", async () => {
  const lines: string[] = [];
  const error = new DOMException("secret-url-and-cookie", "TimeoutError");
  await expect(
    diagnoseHttpRequest(
      "secret-method",
      "/secret-path?token=private",
      async () => {
        throw error;
      },
      (line) => lines.push(line),
    ),
  ).rejects.toBe(error);
  expect(JSON.parse(lines[1])).toMatchObject({
    stage: "failed",
    category: "TimeoutError",
    method: "OTHER",
    route: "/:id",
  });
  expect(lines.join()).not.toMatch(/secret-|private/);
});

it("distinguishes body parsing failures without logging the body", async () => {
  const lines: string[] = [];
  const response = await diagnoseHttpRequest(
    "GET",
    "/api/health",
    async () => new Response("private-invalid-json"),
    (line) => lines.push(line),
  );
  await expect(response.json()).rejects.toBeInstanceOf(SyntaxError);
  expect(lines.map((line) => JSON.parse(line).stage)).toEqual([
    "dispatch",
    "headers",
    "body-json-start",
    "body-json-failed",
  ]);
  expect(lines.join()).not.toContain("private-invalid-json");
});
