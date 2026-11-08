"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { z } from "zod";
import { db } from "@/lib/db";
import { getCurrentUser, isAgent, type Role } from "@/lib/session";
import { emailNotificationPrefsFromForm, parseEmailNotificationPrefs } from "@/lib/notification-email-rules";
import { writeAudit } from "@/lib/audit";
import { sanitizeCommentHtml } from "@/lib/markdown";
import { AUTO_LOCALE, LOCALES, LOCALE_COOKIE, isLocale } from "@/lib/i18n/config";
import { getInstanceLocale } from "@/lib/i18n/server";

export type ActionState =
  | { error?: string; fieldErrors?: Record<string, string[]>; ok?: boolean }
  | undefined;

const schema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  phone: z.string().trim().max(60).optional().default(""),
  jobTitle: z.string().trim().max(120).optional().default(""),
  department: z.string().trim().max(120).optional().default(""),
  timezone: z.string().trim().min(1).default("UTC"),
  // "auto" follows the instance default (Settings › General › Default language).
  locale: z.enum([AUTO_LOCALE, ...LOCALES]).default(AUTO_LOCALE),
  signature: z.string().optional().default(""),
});

/** Current user's editable account fields (for the settings dialog/page). */
export async function getMyAccount() {
  const me = await getCurrentUser();
  if (!me) return null;
  return {
    name: me.name ?? "",
    email: me.email,
    phone: me.phone ?? "",
    jobTitle: me.jobTitle ?? "",
    department: me.department ?? "",
    timezone: me.timezone,
    locale: me.locale,
    instanceLocale: await getInstanceLocale(),
    signature: me.signature ?? "",
    signatureEnabled: me.signatureEnabled,
    // Email copies of notifications concern staff work only; portal users don't see the section.
    isStaff: isAgent(me.role as Role),
    emailNotifications: parseEmailNotificationPrefs(me.emailNotifications),
  };
}

export async function updateMySettings(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const me = await getCurrentUser();
  if (!me || !me.isActive) return { error: "Not authenticated." };

  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return {
      error: "Please fix the errors below.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }
  const d = parsed.data;

  // Switch (base-ui) submits "on" when checked, nothing when unchecked.
  const signatureEnabled = formData.get("signatureEnabled") === "on";
  // Server is the trust boundary — re-sanitize the user-controlled signature
  // HTML even though the editor already sanitizes client-side.
  const signature = d.signature.trim()
    ? sanitizeCommentHtml(d.signature)
    : null;
  // Only when the Notifications section was on the form (staff): its switches send nothing when off.
  const emailNotifications =
    formData.get("emailNotificationsForm") === "1" && isAgent(me.role as Role)
      ? JSON.stringify(emailNotificationPrefsFromForm((name) => formData.get(name)))
      : undefined;

  await db.user.update({
    where: { id: me.id },
    data: {
      name: d.name,
      phone: d.phone || null,
      jobTitle: d.jobTitle || null,
      department: d.department || null,
      timezone: d.timezone,
      locale: d.locale,
      signature,
      signatureEnabled,
      emailNotifications,
    },
  });

  // Remember an explicit language for the signed-out pages (login, survey) on this browser.
  const jar = await cookies();
  if (isLocale(d.locale)) {
    jar.set(LOCALE_COOKIE, d.locale, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
  } else {
    jar.delete(LOCALE_COOKIE);
  }

  await writeAudit({
    userId: me.id,
    action: "UPDATE",
    entity: "User",
    entityId: me.id,
    summary: "Updated account settings",
  });

  revalidatePath("/", "layout");
  return { ok: true };
}
