import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";

export type AppliedMigration = {
  migration_name: string;
  checksum: string;
  finished_at: Date | null;
  rolled_back_at: Date | null;
};
export function expectedMigrations(directory = "prisma/migrations") {
  return Object.fromEntries(
    readdirSync(directory)
      .filter((name) => /^\d/.test(name))
      .sort()
      .map((name) => [
        name,
        createHash("sha256")
          .update(readFileSync(`${directory}/${name}/migration.sql`))
          .digest("hex"),
      ]),
  );
}

/** Exact artifact/history contract: unknown newer migrations block rollback too. */
export function migrationReadiness(
  rows: AppliedMigration[],
  expected: Record<string, string>,
) {
  const issues: string[] = [];
  const applied = rows.filter((row) => !row.rolled_back_at);
  for (const [name, checksum] of Object.entries(expected)) {
    const matches = applied.filter((row) => row.migration_name === name);
    if (
      matches.length !== 1 ||
      !matches[0].finished_at ||
      matches[0].checksum !== checksum
    )
      issues.push(name);
  }
  for (const row of applied)
    if (!(row.migration_name in expected)) issues.push(row.migration_name);
  return [...new Set(issues)].sort();
}
