import NextAuth from "next-auth";
import type { Account } from "next-auth";
import type { Provider } from "next-auth/providers";
import Credentials from "next-auth/providers/credentials";
import { PrismaAdapter } from "@auth/prisma-adapter";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { db } from "@/lib/db";
import { authConfig } from "@/auth.config";
import { loginRetryAfter, recordLoginFailure, recordLoginSuccess } from "@/lib/rate-limit";
import { writeAudit } from "@/lib/audit";
import { guardAdapter } from "@/lib/auth-adapter-guard";
import { recordSignIn } from "@/lib/sign-in-record";
import { oidcRoleConfig, resolveOidcRole, shouldSyncRole, type OidcRoleConfig } from "@/lib/oidc-roles";
import {
  decideOidcLink,
  externalIdCandidates,
  externalIdFromProfile,
  isEmailVerified,
  oidcLinkConfig,
  type LinkMatch,
  type OidcLinkConfig,
} from "@/lib/oidc-link";

const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const providers: Provider[] = [
  Credentials({
    name: "Credentials",
    credentials: {
      email: { label: "Email", type: "email" },
      password: { label: "Password", type: "password" },
    },
    async authorize(raw, request) {
      const parsed = credentialsSchema.safeParse(raw);
      if (!parsed.success) return null;
      const { email, password } = parsed.data;

      // Throttle brute force per-IP AND per-account (lockout + exponential
      // backoff on repeated failures). In-memory, single-instance — see
      // lib/rate-limit.ts. A throttled attempt is rejected before any bcrypt.
      const fwd = request?.headers?.get?.("x-forwarded-for") ?? "";
      const ip = fwd.split(",")[0].trim() || request?.headers?.get?.("x-real-ip")?.trim() || "unknown";
      const accountKey = `login:acct:${email.toLowerCase()}`;
      const ipKey = `login:ip:${ip}`;
      if (loginRetryAfter(accountKey) > 0 || loginRetryAfter(ipKey) > 0) return null;

      const user = await db.user.findUnique({
        where: { email: email.toLowerCase() },
      });
      if (!user || !user.passwordHash || !user.isActive) {
        recordLoginFailure(ipKey);
        recordLoginFailure(accountKey);
        // Audit every rejected attempt (unknown account / deactivated / no password).
        await writeAudit({
          userId: user?.id ?? null,
          action: "LOGIN_FAILED",
          entity: "User",
          entityId: user?.id ?? email.toLowerCase(),
          summary: `Failed login for ${email.toLowerCase()}${user ? "" : " (unknown account)"}`,
          ip,
        });
        return null;
      }

      const ok = await bcrypt.compare(password, user.passwordHash);
      if (!ok) {
        recordLoginFailure(ipKey);
        recordLoginFailure(accountKey);
        await writeAudit({
          userId: user.id,
          action: "LOGIN_FAILED",
          entity: "User",
          entityId: user.id,
          summary: `Failed login for ${user.email} (wrong password)`,
          ip,
        });
        return null;
      }

      recordLoginSuccess(ipKey);
      recordLoginSuccess(accountKey);

      await recordSignIn(user, { method: "password", ip });

      return {
        id: user.id,
        email: user.email,
        name: user.name,
        image: user.image,
        role: user.role,
      };
    },
  }),
];

// Optional SSO / OIDC — only registered when configured.
if (process.env.AUTH_OIDC_ID && process.env.AUTH_OIDC_ISSUER) {
  providers.push({
    id: "oidc",
    name: process.env.AUTH_OIDC_NAME || "SSO",
    type: "oidc",
    issuer: process.env.AUTH_OIDC_ISSUER,
    clientId: process.env.AUTH_OIDC_ID,
    clientSecret: process.env.AUTH_OIDC_SECRET,
    // Never let Auth.js link by a bare email match: an unverified IdP email could
    // take over any local account by collision. Pre-created accounts are linked
    // by linkPrecreatedAccount() below, opt-in and only under its checks.
    allowDangerousEmailAccountLinking: false,
  });
}

export const ssoEnabled = Boolean(
  process.env.AUTH_OIDC_ID && process.env.AUTH_OIDC_ISSUER,
);
export const ssoProviderName = process.env.AUTH_OIDC_NAME || "SSO";

// Optional IdP group/role -> Servio role mapping (#48). A broken map is logged and
// switches mapping off rather than crashing auth; "off" never changes a role.
let roleConfig: OidcRoleConfig | null = null;
try {
  roleConfig = ssoEnabled ? oidcRoleConfig() : null;
} catch (err) {
  console.error(`[auth] OIDC role mapping disabled: ${(err as Error).message}`);
}

/**
 * Persist the mapped role on an SSO sign-in and return the role the session should
 * carry. Runs after the adapter created/linked the user, so `userId` is the DB id.
 */
async function syncOidcRole(userId: string, currentRole: string | undefined, profile: Record<string, unknown> | undefined, isNewUser: boolean) {
  if (!roleConfig || !shouldSyncRole(roleConfig, isNewUser)) return currentRole;
  const role = resolveOidcRole(profile, roleConfig);
  if (!role) {
    console.warn(`[auth] OIDC claim "${roleConfig.claim}" missing for user ${userId}; role left unchanged`);
    return currentRole;
  }
  if (role === currentRole) return role;
  await db.user.update({ where: { id: userId }, data: { role } });
  await writeAudit({
    userId,
    action: "UPDATE",
    entity: "User",
    entityId: userId,
    summary: `Role ${currentRole ?? "USER"} -> ${role} from SSO claim "${roleConfig.claim}"`,
  });
  return role;
}

// Optional linking of a first SSO sign-in to a pre-created account. Like the role
// map, a broken setting is logged and switches linking off.
let linkConfig: OidcLinkConfig | null = null;
try {
  linkConfig = ssoEnabled ? oidcLinkConfig() : null;
} catch (err) {
  console.error(`[auth] OIDC account linking disabled: ${(err as Error).message}`);
}

const linkCandidateSelect = {
  id: true,
  email: true,
  role: true,
  passwordHash: true,
  isActive: true,
  lastLoginAt: true,
  syncSourceId: true,
  _count: { select: { accounts: true } },
} as const;

/** The account a new SSO identity belongs to: by external id first, then by email. */
async function findLinkCandidate(config: OidcLinkConfig, profile: Record<string, unknown>) {
  if (config.externalIdClaim) {
    const externalId = externalIdFromProfile(profile, config.externalIdClaim);
    if (externalId) {
      // externalId is unique per sync source only; two sources claiming it is ambiguous.
      const users = await db.user.findMany({
        where: { externalId: { in: externalIdCandidates(externalId) } },
        select: linkCandidateSelect,
        take: 2,
      });
      if (users.length === 1) return { user: users[0], match: "externalId" as LinkMatch };
      if (users.length > 1) console.warn(`[auth] OIDC external id "${externalId}" matches several accounts; not linking`);
    }
  }
  const email = typeof profile.email === "string" ? profile.email.trim().toLowerCase() : "";
  if (config.byVerifiedEmail && email) {
    const user = await db.user.findUnique({ where: { email }, select: linkCandidateSelect });
    if (user) return { user, match: "email" as LinkMatch };
  }
  return null;
}

/**
 * Link a first SSO sign-in to an account created before its owner ever signed in
 * (directory sync, agent, mail contact). Runs in the signIn callback, before
 * Auth.js resolves the user, so the new link is what it finds. When nothing is
 * linked, Auth.js proceeds as before (new user, or OAuthAccountNotLinked).
 */
async function linkPrecreatedAccount(account: Account, profile: Record<string, unknown>) {
  if (!linkConfig) return;
  const known = await db.account.findUnique({
    where: { provider_providerAccountId: { provider: account.provider, providerAccountId: account.providerAccountId } },
    select: { id: true },
  });
  if (known) return;
  const found = await findLinkCandidate(linkConfig, profile);
  if (!found) return;
  const { user, match } = found;
  const decision = decideOidcLink(
    { ...user, identityCount: user._count.accounts },
    match,
    isEmailVerified(profile),
  );
  if (!decision.link) {
    await writeAudit({
      userId: user.id,
      action: "LOGIN_FAILED",
      entity: "User",
      entityId: user.id,
      summary: `SSO identity not linked to ${user.email} (matched by ${match}): ${decision.reason}`,
    });
    return;
  }
  await db.$transaction([
    db.account.create({
      data: {
        userId: user.id,
        type: account.type,
        provider: account.provider,
        providerAccountId: account.providerAccountId,
        access_token: account.access_token,
        id_token: account.id_token,
        refresh_token: account.refresh_token,
        expires_at: account.expires_at,
        scope: account.scope,
        token_type: account.token_type,
        session_state: typeof account.session_state === "string" ? account.session_state : null,
      },
    }),
    ...(decision.activate ? [db.user.update({ where: { id: user.id }, data: { isActive: true } })] : []),
  ]);
  await writeAudit({
    userId: user.id,
    action: "UPDATE",
    entity: "User",
    entityId: user.id,
    summary: `Linked SSO identity to ${user.email} (matched by ${match})${decision.activate ? "; account activated" : ""}`,
  });
  // The first SSO sign-in of this account: apply the role map even with AUTH_OIDC_ROLE_SYNC=signup.
  await syncOidcRole(user.id, user.role, profile, true);
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  adapter: guardAdapter(PrismaAdapter(db)),
  providers,
  events: {
    // SSO sign-ins: the same last-login stamp and LOGIN audit entry as a password
    // sign-in. (Credentials sign-ins record theirs in authorize, with the throttled IP.)
    async signIn({ user, account }) {
      if (account?.provider !== "oidc" || !user?.id) return;
      try {
        await recordSignIn({ id: user.id, email: user.email }, { method: "sso" });
      } catch (err) {
        console.error(`[auth] could not record SSO sign-in: ${(err as Error).message}`);
      }
    },
  },
  callbacks: {
    ...authConfig.callbacks,
    async signIn({ account, profile }) {
      if (account?.provider === "oidc" && profile) await linkPrecreatedAccount(account, profile);
      return true;
    },
    async jwt(params) {
      const token = authConfig.callbacks.jwt(params);
      const { account, user, profile, isNewUser } = params;
      if (account?.provider === "oidc" && user?.id) {
        token.role = await syncOidcRole(user.id, (user as { role?: string }).role, profile as Record<string, unknown> | undefined, Boolean(isNewUser));
      }
      return token;
    },
  },
});
