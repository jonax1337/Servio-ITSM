/**
 * Pure shape of `GET /api/v1/health` (app/api/v1/health/route.ts): liveness for
 * load balancers and monitoring, and the running version for operators and
 * tooling. The version is shown only to a caller with a valid API token, so an
 * anonymous visitor cannot fingerprint the release.
 */

export type HealthInput = {
  databaseOk: boolean;
  maintenance: boolean;
  /** The running version; null when the caller did not authenticate. */
  version: string | null;
};

export type HealthBody = { status: "ok" | "unavailable"; maintenance: boolean; version?: string };

export function healthResponse({ databaseOk, maintenance, version }: HealthInput): { httpStatus: number; body: HealthBody } {
  const body: HealthBody = { status: databaseOk ? "ok" : "unavailable", maintenance };
  if (version !== null) body.version = version;
  return { httpStatus: databaseOk ? 200 : 503, body };
}
