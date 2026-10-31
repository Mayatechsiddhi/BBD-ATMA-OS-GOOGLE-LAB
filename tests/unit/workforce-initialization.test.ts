import { afterEach, expect, it, vi } from "vitest";
import * as database from "../../src/modules/workforce-control-plane/database";
import { createWorkforceControlPlane } from "../../src/modules/workforce-control-plane/control";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});
function fixture() {
  const client = {
    $transaction: vi.fn().mockResolvedValue(undefined),
    $disconnect: vi.fn().mockResolvedValue(undefined),
  };
  vi.spyOn(database, "workforceDatabase").mockReturnValue(
    client as unknown as ReturnType<typeof database.workforceDatabase>,
  );
  vi.stubEnv(
    "WORKFORCE_AUTH_SECRET",
    "synthetic-workforce-secret-for-lifecycle-tests",
  );
  vi.stubEnv("WORKFORCE_AUTH_URL", "https://workforce.example.test");
  vi.stubEnv("BETTER_AUTH_URL", "https://customer.example.test");
  return client;
}
it("closes the allocated client when readiness fails", async () => {
  const client = fixture();
  client.$transaction.mockRejectedValue(new Error("fixture readiness failure"));
  await expect(createWorkforceControlPlane()).rejects.toThrow(
    "Unsafe workforce runtime database",
  );
  expect(client.$disconnect).toHaveBeenCalledOnce();
});
it("closes the ready client if the workforce signing secret is missing", async () => {
  const client = fixture();
  vi.stubEnv("WORKFORCE_AUTH_SECRET", undefined);
  await expect(createWorkforceControlPlane()).rejects.toThrow(
    "Separate workforce auth secret and origin required",
  );
  expect(client.$transaction).toHaveBeenCalledOnce();
  expect(client.$disconnect).toHaveBeenCalledOnce();
});
it("closes the ready client if workforce origin validation fails", async () => {
  const client = fixture();
  vi.stubEnv(
    "WORKFORCE_AUTH_URL",
    "https://workforce.example.test/invalid-path",
  );
  await expect(createWorkforceControlPlane()).rejects.toThrow(
    "Isolated workforce auth origin required",
  );
  expect(client.$disconnect).toHaveBeenCalledOnce();
});
