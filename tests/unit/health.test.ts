import { afterEach, it, expect, vi } from "vitest";
vi.mock("../../src/lib/db", () => ({ db: { $queryRaw: vi.fn() } }));
vi.mock("../../src/lib/logger", () => ({ logger: { error: vi.fn() } }));
import { db } from "../../src/lib/db";
import { logger } from "../../src/lib/logger";
import { GET } from "../../src/app/api/health/route";
afterEach(() => vi.clearAllMocks());
it("keeps the anonymous health check to one lightweight connectivity query", async () => {
  vi.mocked(db.$queryRaw).mockResolvedValue([{ "?column?": 1 }]);
  const response = await GET();
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ status: "ok" });
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(db.$queryRaw).toHaveBeenCalledTimes(1);
  const query = vi.mocked(db.$queryRaw).mock
    .calls[0][0] as TemplateStringsArray;
  expect([...query].join("")).toBe("SELECT 1");
});
it("fails unavailable without exposing connection details", async () => {
  vi.mocked(db.$queryRaw).mockRejectedValue(
    new Error("synthetic private connection detail"),
  );
  const response = await GET();
  expect(response.status).toBe(503);
  expect(await response.text()).not.toContain("private connection");
  expect(logger.error).toHaveBeenCalledWith({
    event: "database.health.failed",
  });
});
