import NextAuth from "next-auth";
import type { Provider } from "next-auth/providers";
import Credentials from "next-auth/providers/credentials";
import { PrismaAdapter } from "@auth/prisma-adapter";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { db } from "@/lib/db";
import { authConfig } from "@/auth.config";
import { loginRetryAfter, recordLoginFailure, recordLoginSuccess } from "@/lib/rate-limit";
import { writeAudit } from "@/lib/audit";
import { oidcRoleConfig, resolveOidcRole, shouldSyncRole, type OidcRoleConfig } from "@/lib/oidc-roles";

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

      await db.user.update({
        where: { id: user.id },
        data: { lastLoginAt: new Date() },
      });
      await writeAudit({
        userId: user.id,
        action: "LOGIN",
        entity: "User",
        entityId: user.id,
        summary: `Signed in (${user.email})`,
        ip,
      });

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
    // Auto-linking an SSO identity to a local account requires the IdP to assert
    // a VERIFIED email (next-auth's default). The previous opt-in to dangerous
    // linking let an unverified IdP email take over any local account by email
    // collision. Users hitting OAuthAccountNotLinked should verify their IdP
    // email (or an admin links the account manually).
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

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  adapter: PrismaAdapter(db),
  providers,
  callbacks: {
    ...authConfig.callbacks,
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
