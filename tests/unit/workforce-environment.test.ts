import { afterEach, expect, it, vi } from "vitest";
import { workforceDatabase } from "../../src/modules/workforce-control-plane/database";
afterEach(() => vi.unstubAllEnvs());
it("rejects customer database credentials in a production workforce process before connecting", () => {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv(
    "DATABASE_URL",
    "postgresql://synthetic:synthetic@localhost:5432/customer",
  );
  expect(() => workforceDatabase()).toThrow("Isolated workforce process");
});
it("rejects an unverified TLS mode before opening a production workforce connection", () => {
  vi.stubEnv("NODE_ENV", "production");
  for (const key of [
    "DATABASE_URL",
    "RUNTIME_DATABASE_URL",
    "WORKFORCE_MIGRATION_DATABASE_URL",
    "WORKFORCE_TEST_DATABASE_URL",
    "TEST_DATABASE_URL",
    "TEST_RUNTIME_DATABASE_URL",
  ])
    vi.stubEnv(key, undefined);
  vi.stubEnv(
    "WORKFORCE_RUNTIME_DATABASE_URL",
    "postgresql://synthetic:synthetic@localhost:5432/workforce?sslmode=require",
  );
  expect(() => workforceDatabase()).toThrow("verified TLS");
});
