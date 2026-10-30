import { describe, it, expect } from "vitest";
import {
  migrationReadiness,
  expectedMigrations,
  type AppliedMigration,
} from "../../scripts/database-readiness";
import {
  runtimeGrantStatements,
  runtimeRequiredPrivilegesSQL,
} from "../../src/lib/runtime-privileges";
import {
  databasePoolOptions,
  tenantTransactionOptions,
} from "../../src/lib/database-options";
const expected = { one: "first-checksum", two: "second-checksum" };
const rows: AppliedMigration[] = Object.entries(expected).map(
  ([migration_name, checksum]) => ({
    migration_name,
    checksum,
    finished_at: new Date(),
    rolled_back_at: null,
  }),
);
describe("artifact and migration readiness", () => {
  it("bounds pool admission and keeps the original transaction deadlines", () => {
    expect(databasePoolOptions({})).toEqual({
      max: 5,
      connectionTimeoutMillis: 2000,
      idleTimeoutMillis: 10000,
    });
    expect(databasePoolOptions({ DATABASE_POOL_MAX: "1" }).max).toBe(1);
    for (const value of ["0", "21", "1.5", "Infinity", "2;SELECT"])
      expect(() => databasePoolOptions({ DATABASE_POOL_MAX: value })).toThrow(
        "DATABASE_POOL_MAX",
      );
    expect(tenantTransactionOptions).toEqual({ maxWait: 2000, timeout: 5000 });
  });
  it("accepts exact completed history and ignores explicitly rolled-back attempts", () => {
    expect(migrationReadiness(rows, expected)).toEqual([]);
    expect(
      migrationReadiness(
        [
          ...rows,
          { ...rows[0], finished_at: null, rolled_back_at: new Date() },
        ],
        expected,
      ),
    ).toEqual([]);
  });
  it("rejects missing, edited, unfinished, duplicate and unknown/newer applied migrations", () => {
    expect(migrationReadiness(rows.slice(1), expected)).toEqual(["one"]);
    expect(
      migrationReadiness(
        [{ ...rows[0], checksum: "modified" }, rows[1]],
        expected,
      ),
    ).toEqual(["one"]);
    expect(
      migrationReadiness(
        [{ ...rows[0], finished_at: null }, rows[1]],
        expected,
      ),
    ).toEqual(["one"]);
    expect(migrationReadiness([...rows, rows[0]], expected)).toEqual(["one"]);
    expect(migrationReadiness(rows, { one: expected.one })).toEqual(["two"]);
  });
  it("uses every committed migration, rather than a hardcoded schema version", () => {
    const migrations = expectedMigrations();
    expect(Object.keys(migrations)).toHaveLength(11);
    expect(
      Object.values(migrations).every((value) => /^[a-f0-9]{64}$/.test(value)),
    ).toBe(true);
  });
  it("produces an additive quoted role plan with no role alteration or destructive repair", () => {
    const sql = runtimeGrantStatements("bbd_reviewed_runtime").join("\n");
    expect(sql).toContain(
      'GRANT UPDATE ("stage","version","updatedAt") ON TABLE public."Opportunity"',
    );
    expect(sql).not.toMatch(
      /REVOKE|ALTER|DROP|TRUNCATE|GRANT OPTION|CREATE ROLE/,
    );
    expect(sql).not.toContain("_prisma_migrations");
    expect(() => runtimeGrantStatements("runtime; DROP ROLE other")).toThrow();
    expect(() =>
      runtimeRequiredPrivilegesSQL("untrusted" as "session_user"),
    ).toThrow();
  });
});
