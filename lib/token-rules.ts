/**
 * Rules for issuing personal access tokens (Settings › API tokens), DB-free so
 * they can be unit-tested. The action lives in lib/actions/tokens.ts; the scope
 * catalog and how scopes grant access live in lib/api-scopes.ts.
 */
import { ADMIN_ONLY_SCOPES, normalizeScopes, type ApiScope } from "@/lib/api-scopes";

/**
 * The scope presets of the token form. `write` is "full write": every resource
 * read and write, as tokens had before resource scopes. `custom` takes the
 * per-resource selection instead.
 */
export const TOKEN_PRESETS = {
  read: ["read"],
  write: ["read", "write"],
  admin: ["read", "write", "admin"],
} as const satisfies Record<string, readonly ApiScope[]>;
export const TOKEN_PRESET_VALUES = ["read", "write", "admin", "custom"] as const;
export type TokenPreset = (typeof TOKEN_PRESET_VALUES)[number];

/** Longest lifetime an expiring token may be given. */
export const MAX_TOKEN_LIFETIME_DAYS = 3650;

const DAY_MS = 24 * 60 * 60 * 1000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The scopes a token is issued with: the preset's, or for `custom` the picked
 * resource scopes, normalised (see normalizeScopes). An error message when the
 * custom selection is empty or holds an unknown scope.
 */
export function tokenScopes(preset: TokenPreset, picked: readonly string[]): ApiScope[] | { error: string } {
  if (preset !== "custom") return [...TOKEN_PRESETS[preset]];
  if (!picked.some((s) => s.trim())) return { error: "Pick at least one scope." };
  return normalizeScopes(picked) ?? { error: "Pick only scopes from the list." };
}

/**
 * The expiry of a token valid through `date` (YYYY-MM-DD, end of that day in
 * UTC), null for an empty value (never expires), or an error message.
 */
export function tokenExpiry(date: string, now = new Date()): Date | null | { error: string } {
  const value = date.trim();
  if (!value) return null;
  const expiresAt = DATE_RE.test(value) ? new Date(`${value}T23:59:59.999Z`) : new Date(Number.NaN);
  if (Number.isNaN(expiresAt.getTime())) return { error: "Enter the expiry as a date." };
  if (expiresAt.getTime() <= now.getTime()) return { error: "The expiry date must be in the future." };
  if (expiresAt.getTime() - now.getTime() > MAX_TOKEN_LIFETIME_DAYS * DAY_MS) {
    return { error: `A token can expire at most ${MAX_TOKEN_LIFETIME_DAYS} days from now.` };
  }
  return expiresAt;
}

/**
 * Why a token with these scopes may not be issued to this owner, or null. The
 * owner must be an active account, and only an ADMIN may hold `admin` or a
 * privileged scope (`import:write`, `kb:publish`): every endpoint behind them also requires
 * an ADMIN owner, so they would be dead weight.
 */
export function tokenOwnerRefusal(owner: { isActive: boolean; role: string } | null, scopes: readonly string[]): string | null {
  if (!owner) return "Pick an existing account as the token's owner.";
  if (!owner.isActive) return "The token's owner is deactivated.";
  const adminOnly = ADMIN_ONLY_SCOPES.find((s) => scopes.includes(s));
  if (adminOnly && owner.role !== "ADMIN") return `Only an ADMIN account can hold the ${adminOnly} scope.`;
  return null;
}

/** Whether a token can no longer be used. */
export function tokenExpired(expiresAt: Date | null, now = new Date()): boolean {
  return expiresAt !== null && expiresAt.getTime() < now.getTime();
}
