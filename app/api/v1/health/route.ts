import { db } from "@/lib/db";
import { authenticatedPrincipal, ok, preflight } from "@/lib/api";
import { APP_VERSION } from "@/lib/constants";
import { healthResponse } from "@/lib/health-rules";
import { readMaintenanceFlag } from "@/lib/maintenance-flag";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS() {
  return preflight();
}

async function databaseReachable(): Promise<boolean> {
  try {
    await db.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}

/**
 * Public liveness (reachable during maintenance too). With a valid API token of
 * any scope the answer also carries the running version; a token that is sent
 * but invalid gets the usual 401 instead of a silently reduced answer.
 */
export async function GET(req: Request) {
  let version: string | null = null;
  if (req.headers.has("authorization")) {
    const auth = await authenticatedPrincipal(req);
    if ("response" in auth) return auth.response;
    version = APP_VERSION;
  }
  const { httpStatus, body } = healthResponse({
    databaseOk: await databaseReachable(),
    maintenance: readMaintenanceFlag() !== null,
    version,
  });
  const response = ok(body, { status: httpStatus });
  response.headers.set("Cache-Control", "no-store");
  return response;
}
