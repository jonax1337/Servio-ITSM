"use server";

import { revalidatePath } from "next/cache";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { db } from "@/lib/db";
import { getCurrentUser, hasRole, type Role } from "@/lib/session";
import { writeAudit } from "@/lib/audit";
import { ROLES } from "@/lib/constants";
import { AUTOMATION_EMAIL } from "@/lib/system-user";
import { isEmailShape, normalizeEmail, passwordError } from "@/lib/person-rules";
import { normalizeSecondaryEmails, splitEmailList } from "@/lib/user-email-rules";
import { EMAIL_TAKEN, emailTakenByOther, replaceSecondaryEmails } from "@/lib/user-emails";
import { distinctIds } from "@/lib/utils";
import { resolveAccountFlags } from "@/lib/service-accounts";
import { applyAccountFlags } from "@/lib/user-accounts";

// Fresh DB row (not the possibly-stale JWT): only active ADMINs may manage people.
async function requireAdmin() {
  const me = await getCurrentUser();
  return me && me.isActive && hasRole(me.role as Role, "ADMIN") ? me : null;
}

const updateSchema = z.object({
  id: z.string().min(1),
  field: z.enum(["role", "isActive", "isVip"]),
  value: z.string(),
});

export async function updateUserField(formData: FormData) {
  // Only active ADMINs may change user role / activation. isVip is a lighter
  // flag but we keep it admin-gated here too since this is the People admin surface.
  const me = await requireAdmin();
  if (!me) return;

  const parsed = updateSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return;
  const { id, field, value } = parsed.data;

  const target = await db.user.findUnique({ where: { id } });
  if (!target) return;

  // An admin must not lock themselves out or strip their own admin rights.
  if (id === me.id && (field === "role" || field === "isActive")) return;

  const patch: Record<string, unknown> = {};
  if (field === "role") {
    if (!ROLES.includes(value as (typeof ROLES)[number])) return;
    // Never demote the last remaining active admin.
    if (target.role === "ADMIN" && value !== "ADMIN" && (await lastActiveAdmin())) return;
    patch.role = value;
  } else if (field === "isVip") {
    patch.isVip = value === "true";
  } else {
    // Never deactivate the last remaining active admin.
    if (target.role === "ADMIN" && value !== "true" && (await lastActiveAdmin())) return;
    patch.isActive = value === "true";
  }

  await db.user.update({ where: { id }, data: patch });
  await writeAudit({
    userId: me.id,
    action: "UPDATE",
    entity: "User",
    entityId: id,
    summary: `Updated ${field}`,
  });

  revalidatePath(`/people/${id}`);
  revalidatePath("/people");
}

/** True when there is at most one active admin left (i.e. removing one is unsafe). */
async function lastActiveAdmin() {
  const count = await db.user.count({ where: { role: "ADMIN", isActive: true } });
  return count <= 1;
}

// ── Create / edit a person ───────────────────────────────────────────────────

export type PersonState =
  | { ok?: boolean; error?: string; fieldErrors?: Record<string, string[]> }
  | undefined;

const optionalText = z
  .string()
  .optional()
  .transform((v) => (v?.trim() ? v.trim() : null));

const profileSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  email: z.string().transform(normalizeEmail).refine(isEmailShape, "Enter a valid email address."),
  jobTitle: optionalText,
  department: optionalText,
  phone: optionalText,
});

const createSchema = profileSchema.extend({
  role: z.enum(ROLES),
  password: z.string().default(""),
});

/** The account-type checkboxes of the person dialog: "true" / "false", or absent (left as it is). */
const accountSchema = z.object({
  isServiceAccount: z.enum(["true", "false"]).optional().transform((v) => (v === undefined ? undefined : v === "true")),
  canApproveChanges: z.enum(["true", "false"]).optional().transform((v) => (v === undefined ? undefined : v === "true")),
});

const EMAIL_RESERVED = "This address is reserved for the system.";
const UNKNOWN_GROUP = "One of the selected groups no longer exists.";

const fieldError = (field: string, message: string): PersonState => ({
  error: "Please fix the errors below.",
  fieldErrors: { [field]: [message] },
});

/** Why `email` cannot be used for a person (other than `exceptId`), or null. Covers primary and secondary addresses. */
async function emailProblem(email: string, exceptId?: string): Promise<string | null> {
  if (email === AUTOMATION_EMAIL) return EMAIL_RESERVED;
  return (await emailTakenByOther(email, exceptId)) ? EMAIL_TAKEN : null;
}

/** The submitted secondary addresses, validated against the primary and every other person's addresses. */
async function secondaryEmailsFrom(
  formData: FormData,
  primary: string,
  exceptId?: string,
): Promise<{ emails: string[] } | { state: PersonState }> {
  const parsed = normalizeSecondaryEmails(splitEmailList(String(formData.get("secondaryEmails") ?? "")), primary);
  if (!parsed.ok) return { state: fieldError("secondaryEmails", parsed.error) };
  for (const email of parsed.emails) {
    const problem = await emailProblem(email, exceptId);
    if (problem) return { state: fieldError("secondaryEmails", problem) };
  }
  return { emails: parsed.emails };
}

/** True when a write failed on the unique email index (lost a race with another admin). */
const isUniqueViolation = (e: unknown) => typeof e === "object" && e !== null && "code" in e && e.code === "P2002";

export async function createPerson(_prev: PersonState, formData: FormData): Promise<PersonState> {
  const me = await requireAdmin();
  if (!me) return { error: "Not authorised" };

  const parsed = createSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: "Please fix the errors below.", fieldErrors: parsed.error.flatten().fieldErrors };
  }
  const { password, ...profile } = parsed.data;
  const flags = resolveAccountFlags({ isServiceAccount: false, canApproveChanges: true }, accountSchema.parse(Object.fromEntries(formData)));
  if (!flags.ok) return fieldError("canApproveChanges", flags.error);

  // No password = SSO / directory sign-in only (no reset flow exists).
  const badPassword = password ? passwordError(password) : null;
  if (badPassword) return fieldError("password", badPassword);
  const emailIssue = await emailProblem(profile.email);
  if (emailIssue) return fieldError("email", emailIssue);
  const secondary = await secondaryEmailsFrom(formData, profile.email);
  if ("state" in secondary) return secondary.state;
  const groupIds = distinctIds(formData.getAll("groupIds"));
  if (groupIds.length && (await db.group.count({ where: { id: { in: groupIds } } })) !== groupIds.length) {
    return fieldError("groupIds", UNKNOWN_GROUP);
  }

  let created: { id: string };
  try {
    created = await db.user.create({
      data: {
        ...profile,
        isServiceAccount: flags.isServiceAccount,
        canApproveChanges: flags.canApproveChanges,
        passwordHash: password ? await bcrypt.hash(password, 10) : null,
        memberships: { create: groupIds.map((groupId) => ({ groupId })) },
        secondaryEmails: { create: secondary.emails.map((email) => ({ email })) },
      },
      select: { id: true },
    });
  } catch (e) {
    if (isUniqueViolation(e)) return fieldError("email", EMAIL_TAKEN);
    throw e;
  }

  await writeAudit({
    userId: me.id,
    action: "CREATE",
    entity: "User",
    entityId: created.id,
    summary: `Created ${flags.isServiceAccount ? "service account" : profile.role} ${profile.email} (${password ? "local password" : "no local password"}, ${groupIds.length} ${groupIds.length === 1 ? "group" : "groups"})`,
    meta: secondary.emails.length ? { secondaryEmails: secondary.emails } : undefined,
  });
  revalidatePath("/people");
  return { ok: true };
}

const PROFILE_FIELDS = ["name", "email", "jobTitle", "department", "phone"] as const;

export async function updatePerson(_prev: PersonState, formData: FormData): Promise<PersonState> {
  const me = await requireAdmin();
  if (!me) return { error: "Not authorised" };

  const id = String(formData.get("id") ?? "");
  const target = await db.user.findUnique({ where: { id } });
  if (!target || target.email === AUTOMATION_EMAIL) return { error: "Person not found." };

  const parsed = profileSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: "Please fix the errors below.", fieldErrors: parsed.error.flatten().fieldErrors };
  }
  const profile = parsed.data;

  const changed: string[] = PROFILE_FIELDS.filter((f) => (target[f] ?? null) !== profile[f]);

  if (changed.includes("email")) {
    const emailIssue = await emailProblem(profile.email, id);
    if (emailIssue) return fieldError("email", emailIssue);
  }
  const secondary = await secondaryEmailsFrom(formData, profile.email, id);
  if ("state" in secondary) return secondary.state;

  const account = accountSchema.parse(Object.fromEntries(formData));
  const accountCheck = resolveAccountFlags(target, account);
  if (!accountCheck.ok) return fieldError("canApproveChanges", accountCheck.error);
  let accountChange: { changed: string[]; openSeats: number } = { changed: [], openSeats: 0 };
  let secondaryChange: { added: string[]; removed: string[] };
  try {
    // One transaction: if the primary update loses a race for its address, the
    // secondary addresses are not left half-saved. Secondary first: promoting a
    // secondary address to primary removes its row before User.email takes it,
    // so the address is never held twice.
    const replaced = await db.$transaction(async (tx) => {
      const result = await replaceSecondaryEmails(id, secondary.emails, tx);
      if (result.ok && changed.length) await tx.user.update({ where: { id }, data: profile });
      if (!result.ok) return { result, flags: { changed: [], openSeats: 0 } };
      const flags = await applyAccountFlags(id, account, tx);
      if (!flags.ok) throw new Error(flags.error); // checked above; throwing rolls the whole edit back
      return { result, flags };
    });
    if (!replaced.result.ok) return fieldError("secondaryEmails", replaced.result.error);
    accountChange = replaced.flags;
    secondaryChange = replaced.result;
  } catch (e) {
    if (isUniqueViolation(e)) return fieldError("email", EMAIL_TAKEN);
    throw e;
  }
  if (secondaryChange.added.length || secondaryChange.removed.length) changed.push("secondaryEmails");
  changed.push(...accountChange.changed);
  if (changed.length === 0) return { ok: true };

  await writeAudit({
    userId: me.id,
    action: "UPDATE",
    entity: "User",
    entityId: id,
    summary: `Edited profile: ${changed.join(", ")}`,
    meta: {
      ...(changed.includes("email") ? { emailFrom: target.email, emailTo: profile.email } : {}),
      ...(secondaryChange.added.length ? { secondaryAdded: secondaryChange.added } : {}),
      ...(secondaryChange.removed.length ? { secondaryRemoved: secondaryChange.removed } : {}),
      // Seats on changes already in approval are left alone; a manager removes them on the change if they should not count.
      ...(accountChange.openSeats ? { openApprovalSeatsKept: accountChange.openSeats } : {}),
    },
  });
  revalidatePath(`/people/${id}`);
  revalidatePath("/people");
  return { ok: true };
}
