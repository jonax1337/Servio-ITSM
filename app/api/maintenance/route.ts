import { NextResponse } from "next/server";
import { readMaintenanceFlag } from "@/lib/maintenance-flag";
import { toPublicMaintenance } from "@/lib/maintenance-rules";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Public: is maintenance mode on right now? The maintenance page polls this to know when to send visitors back. */
export function GET() {
  const maintenance = toPublicMaintenance(readMaintenanceFlag());
  return NextResponse.json(maintenance ?? { active: false }, { headers: { "Cache-Control": "no-store" } });
}
