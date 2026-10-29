// Preserve Prisma's existing transaction deadlines; do not extend them to hide
// lock/pool pressure. Pool admission has the same bounded acquisition budget.
export const tenantTransactionOptions = {
  maxWait: 2000,
  timeout: 5000,
} as const;
export function databasePoolOptions(
  source: Record<string, string | undefined> = process.env,
) {
  const raw = source.DATABASE_POOL_MAX ?? "5";
  if (!/^\d+$/.test(raw) || Number(raw) < 1 || Number(raw) > 20)
    throw new Error("DATABASE_POOL_MAX must be an integer between 1 and 20");
  return {
    max: Number(raw),
    connectionTimeoutMillis: 2000,
    idleTimeoutMillis: 10000,
  };
}
