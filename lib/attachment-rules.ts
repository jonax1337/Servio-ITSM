// Pure attachment rules: who may write files on which parent, and the fields of
// a REST upload. No DB, no Node-only APIs — unit-tested in tests/unit.
import { z } from "zod";

const RANK: Record<string, number> = { USER: 0, AGENT: 1, MANAGER: 2, ADMIN: 3 };

/** Parents that are staff records: readable by agents only. */
export type RecordTargetKind = "change" | "problem" | "asset" | "license";

/**
 * Whether `role` may add or remove files on a staff record. Changes, problems
 * and assets: any agent. Licenses: MANAGER or above, the console's rule for
 * vendors, contracts and licenses (lib/actions/contracts.ts).
 */
export function mayWriteRecordAttachment(role: string, kind: RecordTargetKind): boolean {
  return (RANK[role] ?? 0) >= (kind === "license" ? RANK.MANAGER : RANK.AGENT);
}

/** The staff record an attachment hangs on, or null for ticket/comment/article/project files. */
export function recordTargetOf(att: {
  changeId?: number | null;
  problemId?: number | null;
  assetId?: string | null;
  licenseId?: string | null;
}): RecordTargetKind | null {
  if (att.changeId != null) return "change";
  if (att.problemId != null) return "problem";
  if (att.assetId != null) return "asset";
  if (att.licenseId != null) return "license";
  return null;
}

/** Ticket statuses that no longer take files (the console's canUploadTo rule). */
export function ticketTakesFiles(status: string): boolean {
  return status !== "CLOSED" && status !== "CANCELLED";
}

/** The REST collections that carry `/{id}/attachments`. */
export const ATTACHMENT_ENTITIES = ["tickets", "changes", "problems", "assets", "licenses"] as const;
export type AttachmentEntity = (typeof ATTACHMENT_ENTITIES)[number];

/** Tolerance for a `created_at` slightly ahead of the server clock. */
const CLOCK_SKEW_MS = 5 * 60_000;

const UPLOAD_FIELDS = ["file", "comment_id", "created_at", "uploaded_by_id", "import_ref"] as const;

const uploadFieldsSchema = z
  .object({
    comment_id: z.string().trim().min(1).max(64).optional(),
    created_at: z.iso.datetime({ offset: true }).optional(),
    uploaded_by_id: z.string().trim().min(1).max(64).optional(),
    import_ref: z.string().trim().min(1).max(200).optional(),
  })
  .strict();

export type UploadFields = {
  commentId?: string;
  createdAt?: Date;
  uploadedById?: string;
  /** Source id of the file (history import): a second upload with the same ref returns the stored file instead of a copy. */
  importRef?: string;
  /** True when the request carries history fields (`created_at` / `uploaded_by_id` / `import_ref`): needs an import-capable token. */
  isImport: boolean;
};

/**
 * Validate the non-file parts of a multipart upload. Strict like every API
 * body: an unknown part, a repeated part or a text where the file belongs is a
 * 422 (field errors in `errors`). `comment_id` is a ticket-only field.
 */
export function parseUploadFields(
  entries: Iterable<[string, FormDataEntryValue]>,
  entity: AttachmentEntity,
  now: Date = new Date(),
): { data: UploadFields } | { errors: Record<string, string[]> } {
  const errors: Record<string, string[]> = {};
  const values: Record<string, string> = {};
  const seen = new Set<string>();
  let files = 0;
  for (const [key, value] of entries) {
    if (!(UPLOAD_FIELDS as readonly string[]).includes(key)) {
      (errors[key] ??= []).push("Unknown field.");
      continue;
    }
    if (key === "file") {
      files += 1;
      if (typeof value === "string") (errors.file ??= []).push("Must be a file part, not text.");
      continue;
    }
    if (seen.has(key)) {
      (errors[key] ??= []).push("Send this field once.");
      continue;
    }
    seen.add(key);
    if (typeof value !== "string") (errors[key] ??= []).push("Must be a text field.");
    else values[key] = value;
  }
  if (files === 0) (errors.file ??= []).push("No file provided.");
  if (files > 1) (errors.file ??= []).push("Upload one file per request.");
  if (values.comment_id !== undefined && entity !== "tickets") (errors.comment_id ??= []).push("Only ticket files can belong to a comment.");

  const parsed = uploadFieldsSchema.safeParse(values);
  if (!parsed.success) {
    for (const [k, msgs] of Object.entries(parsed.error.flatten().fieldErrors)) (errors[k] ??= []).push(...((msgs as string[]) ?? []));
  }
  if (parsed.success && parsed.data.created_at && new Date(parsed.data.created_at).getTime() > now.getTime() + CLOCK_SKEW_MS) {
    (errors.created_at ??= []).push("Must not be in the future.");
  }
  if (Object.keys(errors).length || !parsed.success) return { errors };

  const d = parsed.data;
  return {
    data: {
      commentId: d.comment_id,
      createdAt: d.created_at ? new Date(d.created_at) : undefined,
      uploadedById: d.uploaded_by_id,
      importRef: d.import_ref,
      isImport: d.created_at !== undefined || d.uploaded_by_id !== undefined || d.import_ref !== undefined,
    },
  };
}

/** Whether a token may write history fields: the `/api/v1/import/*` rule (admin scope AND an ADMIN owner). */
export function mayImportHistory(principal: { scopes: string[]; role: string }): boolean {
  return principal.scopes.includes("admin") && principal.role === "ADMIN";
}
