import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
export async function GET() {
  try {
    // Public connectivity probe only. Deep role/grant checks run at startup,
    // in the read-only deployment preflight and uncached in tenant operations.
    await db.$queryRaw`SELECT 1`;
    return Response.json(
      { status: "ok" },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    logger.error({ event: "database.health.failed" });
    return Response.json(
      { status: "unavailable" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
