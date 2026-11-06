"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { requireManagerUser } from "@/lib/session";
import { writeAudit } from "@/lib/audit";
import { assignmentError, contractDateError } from "@/lib/contract-rules";
import { contractSchema, licenseSchema, optionalId, vendorSchema } from "@/lib/contract-schemas";
import type { ActionResult } from "@/lib/action-result";

/** Result of a create/update: `id` identifies the saved record so callers can open it. */
export type SaveResult = ActionResult & { id?: string };

const NOT_AUTHORISED = "Only managers can change vendors, contracts and licenses.";
const refused = (error: string): SaveResult => ({ ok: false, error });

const idSchema = z.string().min(1);

function fieldsOf(formData: FormData) {
  return Object.fromEntries(formData);
}

function firstIssue(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Please check the form.";
}

/** A vendor, owner or contract the form points at must exist before it is stored. */
async function referenceError(refs: { vendorId?: string | null; ownerId?: string | null; contractId?: string | null }) {
  const [vendor, owner, contract] = await Promise.all([
    refs.vendorId ? db.vendor.findUnique({ where: { id: refs.vendorId }, select: { id: true } }) : true,
    refs.ownerId ? db.user.findUnique({ where: { id: refs.ownerId }, select: { id: true } }) : true,
    refs.contractId ? db.contract.findUnique({ where: { id: refs.contractId }, select: { id: true } }) : true,
  ]);
  if (!vendor) return "Vendor not found.";
  if (!owner) return "Owner not found.";
  if (!contract) return "Contract not found.";
  return null;
}

const isUniqueViolation = (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";

// ── Vendors ──────────────────────────────────────────────────────────────────

export async function createVendor(formData: FormData): Promise<SaveResult> {
  const me = await requireManagerUser();
  if (!me) return refused(NOT_AUTHORISED);
  const parsed = vendorSchema.omit({ isActive: true }).safeParse(fieldsOf(formData));
  if (!parsed.success) return refused(firstIssue(parsed.error));

  try {
    const vendor = await db.vendor.create({ data: parsed.data });
    await writeAudit({ userId: me.id, action: "CREATE", entity: "Vendor", entityId: vendor.id, summary: `Created vendor "${vendor.name}"` });
    revalidatePath("/contracts");
    return { ok: true, id: vendor.id };
  } catch (e) {
    if (isUniqueViolation(e)) return refused("A vendor with that name already exists.");
    throw e;
  }
}

export async function updateVendor(formData: FormData): Promise<SaveResult> {
  const me = await requireManagerUser();
  if (!me) return refused(NOT_AUTHORISED);
  const id = idSchema.safeParse(formData.get("id"));
  const parsed = vendorSchema.safeParse(fieldsOf(formData));
  if (!id.success) return refused("Vendor not found.");
  if (!parsed.success) return refused(firstIssue(parsed.error));
  if (!(await db.vendor.findUnique({ where: { id: id.data }, select: { id: true } }))) return refused("Vendor not found.");

  try {
    const vendor = await db.vendor.update({ where: { id: id.data }, data: parsed.data });
    await writeAudit({ userId: me.id, action: "UPDATE", entity: "Vendor", entityId: vendor.id, summary: `Updated vendor "${vendor.name}"` });
    revalidatePath("/contracts");
    revalidatePath(`/contracts/vendors/${vendor.id}`);
    return { ok: true, id: vendor.id };
  } catch (e) {
    if (isUniqueViolation(e)) return refused("A vendor with that name already exists.");
    throw e;
  }
}

/** Contracts and licenses of a deleted vendor stay, without a vendor (relation is SetNull). */
export async function deleteVendor(formData: FormData): Promise<SaveResult> {
  const me = await requireManagerUser();
  if (!me) return refused(NOT_AUTHORISED);
  const id = String(formData.get("id") ?? "");
  const vendor = await db.vendor.findUnique({ where: { id }, select: { name: true } });
  if (!vendor) return refused("Vendor not found.");

  await db.vendor.delete({ where: { id } });
  await writeAudit({ userId: me.id, action: "DELETE", entity: "Vendor", entityId: id, summary: `Deleted vendor "${vendor.name}"` });
  revalidatePath("/contracts");
  redirect("/contracts?tab=vendors");
}

// ── Contracts ────────────────────────────────────────────────────────────────

export async function createContract(formData: FormData): Promise<SaveResult> {
  const me = await requireManagerUser();
  if (!me) return refused(NOT_AUTHORISED);
  const parsed = contractSchema.safeParse(fieldsOf(formData));
  if (!parsed.success) return refused(firstIssue(parsed.error));
  const data = parsed.data;

  const problem = contractDateError(data.startDate, data.endDate) ?? (await referenceError(data));
  if (problem) return refused(problem);

  const contract = await db.contract.create({ data });
  await writeAudit({ userId: me.id, action: "CREATE", entity: "Contract", entityId: contract.id, summary: `Created contract "${contract.name}"` });
  revalidatePath("/contracts");
  return { ok: true, id: contract.id };
}

export async function updateContract(formData: FormData): Promise<SaveResult> {
  const me = await requireManagerUser();
  if (!me) return refused(NOT_AUTHORISED);
  const id = idSchema.safeParse(formData.get("id"));
  const parsed = contractSchema.safeParse(fieldsOf(formData));
  if (!id.success) return refused("Contract not found.");
  if (!parsed.success) return refused(firstIssue(parsed.error));
  const data = parsed.data;

  const problem = contractDateError(data.startDate, data.endDate) ?? (await referenceError(data));
  if (problem) return refused(problem);
  if (!(await db.contract.findUnique({ where: { id: id.data }, select: { id: true } }))) return refused("Contract not found.");

  const contract = await db.contract.update({ where: { id: id.data }, data });
  await writeAudit({ userId: me.id, action: "UPDATE", entity: "Contract", entityId: contract.id, summary: `Updated contract "${contract.name}"` });
  revalidatePath("/contracts");
  revalidatePath(`/contracts/${contract.id}`);
  return { ok: true, id: contract.id };
}

/** Licenses under a deleted contract stay, without a contract (relation is SetNull). */
export async function deleteContract(formData: FormData): Promise<SaveResult> {
  const me = await requireManagerUser();
  if (!me) return refused(NOT_AUTHORISED);
  const id = String(formData.get("id") ?? "");
  const contract = await db.contract.findUnique({
    where: { id },
    select: { name: true, assets: { select: { assetId: true } } },
  });
  if (!contract) return refused("Contract not found.");

  await db.contract.delete({ where: { id } });
  await writeAudit({ userId: me.id, action: "DELETE", entity: "Contract", entityId: id, summary: `Deleted contract "${contract.name}"` });
  revalidatePath("/contracts");
  for (const { assetId } of contract.assets) revalidatePath(`/assets/${assetId}`);
  redirect("/contracts");
}

export async function linkContractAsset(formData: FormData): Promise<SaveResult> {
  const me = await requireManagerUser();
  if (!me) return refused(NOT_AUTHORISED);
  const contractId = String(formData.get("contractId") ?? "").trim();
  const assetId = String(formData.get("assetId") ?? "").trim();
  if (!contractId || !assetId) return refused("Choose a contract and an asset.");

  const [contract, asset] = await Promise.all([
    db.contract.findUnique({ where: { id: contractId }, select: { name: true } }),
    db.asset.findUnique({ where: { id: assetId }, select: { name: true } }),
  ]);
  if (!contract) return refused("Contract not found.");
  if (!asset) return refused("Asset not found.");

  await db.contractAsset.upsert({
    where: { contractId_assetId: { contractId, assetId } },
    create: { contractId, assetId },
    update: {},
  });
  await writeAudit({ userId: me.id, action: "UPDATE", entity: "Contract", entityId: contractId, summary: `Covered asset "${asset.name}"` });
  await writeAudit({ userId: me.id, action: "UPDATE", entity: "Asset", entityId: assetId, summary: `Covered by contract "${contract.name}"` });
  revalidatePath(`/contracts/${contractId}`);
  revalidatePath(`/assets/${assetId}`);
  return { ok: true };
}

export async function unlinkContractAsset(formData: FormData): Promise<SaveResult> {
  const me = await requireManagerUser();
  if (!me) return refused(NOT_AUTHORISED);
  const contractId = String(formData.get("contractId") ?? "").trim();
  const assetId = String(formData.get("assetId") ?? "").trim();
  if (!contractId || !assetId) return refused("Missing link.");

  const row = await db.contractAsset.findUnique({
    where: { contractId_assetId: { contractId, assetId } },
    select: { contract: { select: { name: true } }, asset: { select: { name: true } } },
  });
  if (!row) return { ok: true }; // already removed

  await db.contractAsset.delete({ where: { contractId_assetId: { contractId, assetId } } });
  await writeAudit({ userId: me.id, action: "UPDATE", entity: "Contract", entityId: contractId, summary: `No longer covers asset "${row.asset.name}"` });
  await writeAudit({ userId: me.id, action: "UPDATE", entity: "Asset", entityId: assetId, summary: `No longer covered by contract "${row.contract.name}"` });
  revalidatePath(`/contracts/${contractId}`);
  revalidatePath(`/assets/${assetId}`);
  return { ok: true };
}

// ── Licenses ─────────────────────────────────────────────────────────────────

export async function createLicense(formData: FormData): Promise<SaveResult> {
  const me = await requireManagerUser();
  if (!me) return refused(NOT_AUTHORISED);
  const parsed = licenseSchema.safeParse(fieldsOf(formData));
  if (!parsed.success) return refused(firstIssue(parsed.error));

  const problem = await referenceError(parsed.data);
  if (problem) return refused(problem);

  const license = await db.softwareLicense.create({ data: parsed.data });
  await writeAudit({ userId: me.id, action: "CREATE", entity: "SoftwareLicense", entityId: license.id, summary: `Created license "${license.name}"` });
  revalidatePath("/contracts");
  return { ok: true, id: license.id };
}

export async function updateLicense(formData: FormData): Promise<SaveResult> {
  const me = await requireManagerUser();
  if (!me) return refused(NOT_AUTHORISED);
  const id = idSchema.safeParse(formData.get("id"));
  const parsed = licenseSchema.safeParse(fieldsOf(formData));
  if (!id.success) return refused("License not found.");
  if (!parsed.success) return refused(firstIssue(parsed.error));

  const problem = await referenceError(parsed.data);
  if (problem) return refused(problem);
  if (!(await db.softwareLicense.findUnique({ where: { id: id.data }, select: { id: true } }))) return refused("License not found.");

  const license = await db.softwareLicense.update({ where: { id: id.data }, data: parsed.data });
  await writeAudit({ userId: me.id, action: "UPDATE", entity: "SoftwareLicense", entityId: license.id, summary: `Updated license "${license.name}"` });
  revalidatePath("/contracts");
  revalidatePath(`/contracts/licenses/${license.id}`);
  return { ok: true, id: license.id };
}

export async function deleteLicense(formData: FormData): Promise<SaveResult> {
  const me = await requireManagerUser();
  if (!me) return refused(NOT_AUTHORISED);
  const id = String(formData.get("id") ?? "");
  const license = await db.softwareLicense.findUnique({
    where: { id },
    select: { name: true, assignments: { select: { assetId: true } } },
  });
  if (!license) return refused("License not found.");

  await db.softwareLicense.delete({ where: { id } });
  await writeAudit({ userId: me.id, action: "DELETE", entity: "SoftwareLicense", entityId: id, summary: `Deleted license "${license.name}"` });
  revalidatePath("/contracts");
  for (const { assetId } of license.assignments) if (assetId) revalidatePath(`/assets/${assetId}`);
  redirect("/contracts?tab=licenses");
}

/**
 * Assign one seat to a user, an asset, or both. Seats beyond the purchased count are
 * allowed on purpose: the license shows as over-allocated and the owner is alerted.
 */
export async function assignLicense(formData: FormData): Promise<SaveResult> {
  const me = await requireManagerUser();
  if (!me) return refused(NOT_AUTHORISED);
  const licenseId = String(formData.get("licenseId") ?? "").trim();
  const userId = optionalId.parse(formData.get("userId") ?? undefined);
  const assetId = optionalId.parse(formData.get("assetId") ?? undefined);

  const license = await db.softwareLicense.findUnique({
    where: { id: licenseId },
    select: { name: true, assignments: { select: { userId: true, assetId: true } } },
  });
  if (!license) return refused("License not found.");
  const problem = assignmentError({ userId, assetId }, license.assignments);
  if (problem) return refused(problem);

  const [user, asset] = await Promise.all([
    userId ? db.user.findUnique({ where: { id: userId }, select: { name: true, email: true } }) : null,
    assetId ? db.asset.findUnique({ where: { id: assetId }, select: { name: true } }) : null,
  ]);
  if (userId && !user) return refused("User not found.");
  if (assetId && !asset) return refused("Asset not found.");

  await db.licenseAssignment.create({ data: { licenseId, userId, assetId } });
  const target = [user && (user.name ?? user.email), asset?.name].filter(Boolean).join(" on ");
  await writeAudit({ userId: me.id, action: "UPDATE", entity: "SoftwareLicense", entityId: licenseId, summary: `Assigned a seat to ${target}` });
  revalidatePath(`/contracts/licenses/${licenseId}`);
  revalidatePath("/contracts");
  if (assetId) revalidatePath(`/assets/${assetId}`);
  return { ok: true };
}

export async function unassignLicense(formData: FormData): Promise<SaveResult> {
  const me = await requireManagerUser();
  if (!me) return refused(NOT_AUTHORISED);
  const assignmentId = String(formData.get("assignmentId") ?? "").trim();

  const row = await db.licenseAssignment.findUnique({
    where: { id: assignmentId },
    select: { licenseId: true, assetId: true, license: { select: { name: true } } },
  });
  if (!row) return { ok: true }; // already removed

  await db.licenseAssignment.delete({ where: { id: assignmentId } });
  await writeAudit({ userId: me.id, action: "UPDATE", entity: "SoftwareLicense", entityId: row.licenseId, summary: `Released a seat of "${row.license.name}"` });
  revalidatePath(`/contracts/licenses/${row.licenseId}`);
  revalidatePath("/contracts");
  if (row.assetId) revalidatePath(`/assets/${row.assetId}`);
  return { ok: true };
}
