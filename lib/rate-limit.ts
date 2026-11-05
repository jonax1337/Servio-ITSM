/**
 * Dependency-free, in-memory rate limiter.
 *
 * SINGLE-INSTANCE ONLY: state lives in this process's heap, which matches
 * Servio's single-node deployment model. Behind a multi-instance load balancer
 * each replica keeps its own counters, so limits are per-replica — swap this for
 * a shared store (Redis) if you ever scale horizontally.
 *
 * Provides two primitives:
 *  - `slidingWindow` — N events per window per key (used for the Bearer API).
 *  - `loginThrottle` — failure-driven lockout with exponential backoff (login).
 */

type Hit = { count: number; resetAt: number };

/** Generic fixed-size sliding window. Returns whether the event is allowed. */
export function slidingWindow(
  store: Map<string, Hit>,
  key: string,
  limit: number,
  windowMs: number,
  now = Date.now(),
): { allowed: boolean; remaining: number; retryAfterMs: number } {
  const hit = store.get(key);
  if (!hit || hit.resetAt <= now) {
    store.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: limit - 1, retryAfterMs: 0 };
  }
  if (hit.count >= limit) {
    return { allowed: false, remaining: 0, retryAfterMs: hit.resetAt - now };
  }
  hit.count += 1;
  return { allowed: true, remaining: limit - hit.count, retryAfterMs: 0 };
}

/** Opportunistically drop expired entries so the maps don't grow unbounded. */
function sweep(store: Map<string, { resetAt: number }>, now: number) {
  if (store.size < 1000) return;
  for (const [k, v] of store) if (v.resetAt <= now) store.delete(k);
}

// ---- Bearer API entry limiter --------------------------------------------

const API_LIMIT = Number(process.env.API_RATE_LIMIT ?? 120);
const API_WINDOW_MS = Number(process.env.API_RATE_WINDOW_MS ?? 60_000);
const apiStore = new Map<string, Hit>();

/**
 * Rate-limit an API caller keyed by token (preferred) or client IP. Returns
 * `null` when allowed, or `{ retryAfterMs }` when the caller should be 429'd.
 */
export function checkApiRate(key: string, now = Date.now()): { retryAfterMs: number } | null {
  sweep(apiStore, now);
  const res = slidingWindow(apiStore, key, API_LIMIT, API_WINDOW_MS, now);
  return res.allowed ? null : { retryAfterMs: res.retryAfterMs };
}

// ---- AI endpoint limiter ---------------------------------------------------

const AI_LIMIT = Number(process.env.AI_RATE_LIMIT ?? 20);
const AI_WINDOW_MS = Number(process.env.AI_RATE_WINDOW_MS ?? 60_000);
const aiStore = new Map<string, Hit>();

/**
 * Rate-limit an AI endpoint call keyed by the session user id. Every chat turn
 * drives a provider request (tokens cost money / local CPU), so a looping
 * client must not be able to fire unbounded generations. Returns `null` when
 * allowed, or `{ retryAfterMs }` for a 429.
 */
export function checkAiRate(userId: string, now = Date.now()): { retryAfterMs: number } | null {
  sweep(aiStore, now);
  const res = slidingWindow(aiStore, `ai:${userId}`, AI_LIMIT, AI_WINDOW_MS, now);
  return res.allowed ? null : { retryAfterMs: res.retryAfterMs };
}

// ---- Portal reply + upload limiters ----------------------------------------

const REPLY_LIMIT = Number(process.env.REPLY_RATE_LIMIT ?? 10);
const UPLOAD_LIMIT = Number(process.env.UPLOAD_RATE_LIMIT ?? 30);
const WRITE_WINDOW_MS = Number(process.env.WRITE_RATE_WINDOW_MS ?? 60_000);
const replyStore = new Map<string, Hit>();
const uploadStore = new Map<string, Hit>();

function checkUserRate(store: Map<string, Hit>, userId: string, limit: number, now: number) {
  sweep(store, now);
  const res = slidingWindow(store, userId, limit, WRITE_WINDOW_MS, now);
  return res.allowed ? null : { retryAfterMs: res.retryAfterMs };
}

/**
 * Rate-limit ticket replies posted from the portal (form and Sable assistant),
 * keyed by session user id. Returns `null` when allowed, or `{ retryAfterMs }`.
 */
export function checkReplyRate(userId: string, now = Date.now()): { retryAfterMs: number } | null {
  return checkUserRate(replyStore, userId, REPLY_LIMIT, now);
}

/** Rate-limit file uploads (every upload target), keyed by session user id. */
export function checkUploadRate(userId: string, now = Date.now()): { retryAfterMs: number } | null {
  return checkUserRate(uploadStore, userId, UPLOAD_LIMIT, now);
}

// ---- Login credential throttle -------------------------------------------

type Lock = { failures: number; lockedUntil: number; resetAt: number };

const LOGIN_FREE_ATTEMPTS = Number(process.env.LOGIN_FREE_ATTEMPTS ?? 5);
const LOGIN_BASE_BACKOFF_MS = Number(process.env.LOGIN_BASE_BACKOFF_MS ?? 2_000);
const LOGIN_MAX_BACKOFF_MS = Number(process.env.LOGIN_MAX_BACKOFF_MS ?? 15 * 60_000);
// Window after which a quiet key's failure count decays back to zero.
const LOGIN_DECAY_MS = Number(process.env.LOGIN_DECAY_MS ?? 15 * 60_000);
const loginStore = new Map<string, Lock>();

/**
 * Returns how long (ms) the caller must wait before another login attempt is
 * allowed, or 0 when it may proceed. Call this BEFORE verifying credentials.
 */
export function loginRetryAfter(key: string, now = Date.now()): number {
  sweep(loginStore, now);
  const lock = loginStore.get(key);
  if (!lock) return 0;
  if (lock.resetAt <= now) {
    loginStore.delete(key);
    return 0;
  }
  return lock.lockedUntil > now ? lock.lockedUntil - now : 0;
}

/** Record a failed login; grows the backoff exponentially past the free tier. */
export function recordLoginFailure(key: string, now = Date.now()): void {
  const lock = loginStore.get(key);
  const failures = (lock && lock.resetAt > now ? lock.failures : 0) + 1;
  let lockedUntil = 0;
  if (failures > LOGIN_FREE_ATTEMPTS) {
    const over = failures - LOGIN_FREE_ATTEMPTS;
    const backoff = Math.min(LOGIN_BASE_BACKOFF_MS * 2 ** (over - 1), LOGIN_MAX_BACKOFF_MS);
    lockedUntil = now + backoff;
  }
  loginStore.set(key, { failures, lockedUntil, resetAt: now + LOGIN_DECAY_MS });
}

/** Clear a key's failure state after a successful login. */
export function recordLoginSuccess(key: string): void {
  loginStore.delete(key);
}
