/**
 * Linking a first SSO sign-in to an account that already exists in Servio.
 *
 * Accounts are often created before their owner ever signs in: by a directory
 * sync (`lib/connectors/*`), by an agent, or as an inactive contact from the
 * mail inbox. Such an account has no OIDC identity, so Auth.js refuses the
 * first SSO sign-in with `OAuthAccountNotLinked`. This module decides — pure and
 * DB-free, so it can be unit-tested — whether linking is safe; the wiring lives
 * in `auth.ts` (signIn callback).
 *
 * Configuration (both off by default):
 *
 *   AUTH_OIDC_LINK_EXISTING  "off" (default) | "email_verified": link by email,
 *                            but only when the IdP asserts `email_verified`.
 *   AUTH_OIDC_LINK_CLAIM     claim (dot path allowed) whose value must equal the
 *                            account's `externalId` from the directory sync, e.g.
 *                            the LDAP object GUID the IdP passes through.
 *
 * Whichever way the account was found, it is only linked when it has no password
 * and no SSO identity yet: a password account belongs to someone who can sign in
 * already, and an existing identity means the account is someone else's.
 */
import { claimValues } from "@/lib/oidc-roles";

export const OIDC_LINK_MODES = ["off", "email_verified"] as const;
export type OidcLinkMode = (typeof OIDC_LINK_MODES)[number];

export type OidcLinkConfig = {
  /** Link by email when the IdP marks it verified. */
  byVerifiedEmail: boolean;
  /** Claim matched against `User.externalId`, or null. */
  externalIdClaim: string | null;
};

/** The linking config from the environment, or null when linking is off. Throws on an unknown mode. */
export function oidcLinkConfig(env: Record<string, string | undefined> = process.env): OidcLinkConfig | null {
  const mode = (env.AUTH_OIDC_LINK_EXISTING?.trim().toLowerCase() || "off") as OidcLinkMode;
  if (!OIDC_LINK_MODES.includes(mode)) {
    throw new Error(`AUTH_OIDC_LINK_EXISTING must be one of ${OIDC_LINK_MODES.join(", ")}`);
  }
  const externalIdClaim = env.AUTH_OIDC_LINK_CLAIM?.trim() || null;
  if (mode === "off" && !externalIdClaim) return null;
  return { byVerifiedEmail: mode === "email_verified", externalIdClaim };
}

/** OIDC's `email_verified` is a boolean; some IdPs send the string "true". */
export function isEmailVerified(profile: Record<string, unknown> | undefined): boolean {
  const v = profile?.email_verified;
  return v === true || v === "true";
}

/** The single value of the external-id claim, or null when it is missing or ambiguous. */
export function externalIdFromProfile(profile: Record<string, unknown> | undefined, claim: string): string | null {
  const values = claimValues(profile, claim);
  return values?.length === 1 ? values[0] : null;
}

export type LinkCandidate = {
  passwordHash: string | null;
  isActive: boolean;
  lastLoginAt: Date | null;
  syncSourceId: string | null;
  /** Number of SSO identities already linked to the account. */
  identityCount: number;
};

export type LinkMatch = "email" | "externalId";

export type LinkRefusal = "email-not-verified" | "has-password" | "has-identity" | "deactivated";

export type LinkDecision = { link: true; activate: boolean } | { link: false; reason: LinkRefusal };

/**
 * A contact that was created but never used: inactive, never signed in and not
 * owned by a directory sync. Signing in with SSO activates it. Anything else that
 * is inactive was switched off on purpose (by an admin, or by the sync because
 * the person left the directory) and stays off.
 */
function isUnusedContact(c: LinkCandidate): boolean {
  return !c.isActive && c.lastLoginAt === null && c.syncSourceId === null;
}

export function decideOidcLink(candidate: LinkCandidate, match: LinkMatch, emailVerified: boolean): LinkDecision {
  if (match === "email" && !emailVerified) return { link: false, reason: "email-not-verified" };
  if (candidate.passwordHash !== null) return { link: false, reason: "has-password" };
  if (candidate.identityCount > 0) return { link: false, reason: "has-identity" };
  if (!candidate.isActive && !isUnusedContact(candidate)) return { link: false, reason: "deactivated" };
  return { link: true, activate: !candidate.isActive };
}
