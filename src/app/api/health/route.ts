import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
export async function GET() {
  try {
    await db.$queryRaw`SELECT 1`;
    return Response.json(
      { status: "ok" },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    logger.error({ event: "database.health.failed" });
    return Response.json({ status: "unavailable" }, { status: 503 });
  }
}
