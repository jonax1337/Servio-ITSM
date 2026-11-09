import { revalidatePath } from "next/cache";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { apiError, ok } from "@/lib/api";
import { writeAudit } from "@/lib/audit";
import { apiFieldNames, changedColumns } from "@/lib/api-record-diff";
import { VENDOR_FIELD_RENAMES, vendorData, type VendorPatch } from "@/lib/api-asset-input";
import { serializeVendor } from "./_serializers";
import { importRefTaken, isUniqueOn } from "./_manage";

/** Shared plumbing of the /vendors endpoints (same rules as the console's vendor form). */

export const VENDOR_WHAT = "vendors";

type VendorRow = Parameters<typeof serializeVendor>[0];
type Data = ReturnType<typeof vendorData>;

export function vendorNotFound() {
  return apiError(404, "Vendor not found");
}

function duplicateName(id?: string) {
  return apiError(409, "A vendor with that name already exists.", id ? { id } : undefined);
}

/** The Prisma data for a body on top of `current` (absent on create): 409 for a name or import_ref another vendor has. */
export async function prepareVendor(b: Partial<VendorPatch>, current: VendorRow | null): Promise<{ data: Data } | { response: ReturnType<typeof apiError> }> {
  const data = vendorData(b);
  if (data.name && data.name !== current?.name) {
    const clash = await db.vendor.findUnique({ where: { name: data.name }, select: { id: true } });
    if (clash && clash.id !== current?.id) return { response: duplicateName(clash.id) };
  }
  if (data.importRef && data.importRef !== current?.importRef) {
    const taken = await db.vendor.findUnique({ where: { importRef: data.importRef }, select: { id: true } });
    if (taken && taken.id !== current?.id) return { response: importRefTaken(taken.id) };
  }
  return { data };
}

export async function createVendorRecord(data: Data & { name: string }, actorId: string, via: string) {
  const vendor = await db.vendor.create({ data: data as Prisma.VendorUncheckedCreateInput });
  await writeAudit({ userId: actorId, action: "CREATE", entity: "Vendor", entityId: vendor.id, summary: `Created vendor "${vendor.name}" via ${via}` });
  revalidatePath("/contracts");
  return vendor;
}

/** Write the columns that differ from `current`; an unchanged body writes nothing and no audit row. */
export async function updateVendorRecord(current: VendorRow & { id: string }, data: Data, actorId: string, via: string) {
  const columns = changedColumns(current, data);
  const changed = apiFieldNames(columns, VENDOR_FIELD_RENAMES);
  if (columns.length === 0) return { vendor: current, changed };
  const patch = Object.fromEntries(columns.map((k) => [k, data[k as keyof Data]]));
  const vendor = await db.vendor.update({ where: { id: current.id }, data: patch });
  await writeAudit({
    userId: actorId, action: "UPDATE", entity: "Vendor", entityId: vendor.id,
    summary: `Updated vendor "${vendor.name}" via ${via} (${changed.join(", ")})`, meta: { changed },
  });
  revalidatePath("/contracts");
  revalidatePath(`/contracts/vendors/${vendor.id}`);
  return { vendor, changed };
}

export function vendorResponse(v: VendorRow, init?: { status?: number; meta?: unknown }) {
  return ok(serializeVendor(v), init);
}

/** 409 for a unique value lost to a concurrent writer; otherwise rethrows. */
export function vendorWriteConflict(err: unknown) {
  if (isUniqueOn(err, "importRef")) return importRefTaken();
  if (isUniqueOn(err, "name")) return duplicateName();
  throw err;
}
