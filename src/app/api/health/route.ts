import { assertRuntimeDatabase } from "@/lib/tenant-context";
import { logger } from "@/lib/logger";
export async function GET() {
  try {
    await assertRuntimeDatabase();
    return Response.json(
      { status: "ok" },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    logger.error({ event: "database.health.failed" });
    return Response.json({ status: "unavailable" }, { status: 503 });
  }
}
