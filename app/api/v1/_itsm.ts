import type { z } from "zod";
import type { NextResponse } from "next/server";
import { guard, apiError, principalIsAgent, type ApiPrincipal } from "@/lib/api";
import type { ResourceScope } from "@/lib/api-scopes";
import { runAsApiActor } from "@/lib/api-actor";
import { refusalStatus } from "@/lib/api-itsm-input";

/**
 * Shared plumbing of the ITSM endpoints (changes, problems, comments, lookups).
 * Changes and problems are staff records, so unlike /tickets every endpoint
 * here is agent-only: a USER token gets 403 on all of them.
 */
export async function agentGuard(
  req: Request,
  scope: ResourceScope,
): Promise<{ principal: ApiPrincipal } | { response: NextResponse }> {
  const auth = await guard(req, scope);
  if ("response" in auth) return auth;
  if (!principalIsAgent(auth.principal)) {
    return { response: apiError(403, "This endpoint needs a token owned by an agent (AGENT, MANAGER or ADMIN).") };
  }
  return auth;
}

/** A positive integer record id from a route segment, or null (callers answer 404). */
export function recordId(raw: string): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** Parse and validate a JSON body: 400 on malformed JSON, 422 with field errors on a schema miss. */
export async function readBody<S extends z.ZodType>(
  req: Request,
  schema: S,
): Promise<{ data: z.infer<S> } | { response: NextResponse }> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return { response: apiError(400, "Invalid JSON body") };
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    const flat = (parsed.error as z.ZodError).flatten();
    return { response: apiError(422, "Validation failed", { ...flat.fieldErrors, ...(flat.formErrors.length ? { _: flat.formErrors } : {}) }) };
  }
  return { data: parsed.data };
}

/** A console action's refusal as an API error (404 / 403 / 422 / 409, see refusalStatus). */
export function refusal(message: string, details?: unknown) {
  return apiError(refusalStatus(message), message, details);
}

/** Run console server actions as the token's owner (see lib/api-actor.ts). */
export function asActor<T>(principal: ApiPrincipal, fn: () => Promise<T>): Promise<T> {
  return runAsApiActor(principal.userId, fn);
}
