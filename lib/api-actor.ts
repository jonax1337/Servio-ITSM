// No "server-only" marker: lib/session.ts imports this and is itself pulled into
// unit tests. node:async_hooks keeps it out of client bundles anyway.
import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Lets a REST API request run the console's own server actions as the token's
 * owner, so every business rule (workflow map, CAB, freeze windows, field locks,
 * DB-truth role checks, audit attribution) applies to the API exactly as it does
 * in the UI — instead of being re-implemented, and drifting, per endpoint.
 *
 * `getSessionUser()` (lib/session.ts) consults this store first. It is only ever
 * entered by `runAsApiActor`, which the /api/v1 handlers call AFTER `guard()`
 * authenticated the Bearer token; there is no other way in (a "use server"
 * action cannot set it), so a browser session can never be impersonated.
 */
const store = new AsyncLocalStorage<{ userId: string }>();

export function runAsApiActor<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  return store.run({ userId }, fn);
}

/** The API token owner the current call runs as, or null outside an API actor scope. */
export function apiActorUserId(): string | null {
  return store.getStore()?.userId ?? null;
}
