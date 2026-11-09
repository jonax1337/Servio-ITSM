import { describe, expect, it } from "vitest";
import {
  mayImportHistory,
  mayWriteRecordAttachment,
  parseUploadFields,
  recordTargetOf,
  ticketTakesFiles,
} from "@/lib/attachment-rules";
import { contentDisposition, UPLOAD_ERROR_STATUS, validateUpload } from "@/lib/files";

const file = new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], "a.pdf", { type: "application/pdf" });
const NOW = new Date("2026-11-08T12:00:00Z");
const parse = (entries: [string, FormDataEntryValue][], entity: Parameters<typeof parseUploadFields>[1] = "tickets") =>
  parseUploadFields(entries, entity, NOW);

describe("parseUploadFields", () => {
  it("accepts a lone file as a plain upload", () => {
    expect(parse([["file", file]])).toEqual({ data: { commentId: undefined, createdAt: undefined, uploadedById: undefined, isImport: false } });
  });

  it("needs exactly one file part", () => {
    expect(parse([])).toEqual({ errors: { file: ["No file provided."] } });
    expect(parse([["file", file], ["file", file]])).toEqual({ errors: { file: ["Upload one file per request."] } });
    expect(parse([["file", "not a file"]])).toEqual({ errors: { file: ["Must be a file part, not text."] } });
  });

  it("is strict about unknown and repeated fields", () => {
    const r = parse([["file", file], ["commentId", "c1"], ["comment_id", "c1"], ["comment_id", "c2"]]);
    expect(r).toEqual({ errors: { commentId: ["Unknown field."], comment_id: ["Send this field once."] } });
  });

  it("takes comment_id on tickets only", () => {
    expect(parse([["file", file], ["comment_id", "c1"]])).toMatchObject({ data: { commentId: "c1", isImport: false } });
    expect(parse([["file", file], ["comment_id", "c1"]], "changes")).toEqual({ errors: { comment_id: ["Only ticket files can belong to a comment."] } });
  });

  it("marks history fields as an import and parses created_at with its offset", () => {
    const r = parse([["file", file], ["created_at", "2024-03-01T09:30:00+01:00"], ["uploaded_by_id", "u1"]], "licenses");
    expect(r).toEqual({ data: { commentId: undefined, createdAt: new Date("2024-03-01T08:30:00Z"), uploadedById: "u1", isImport: true } });
    expect(parse([["file", file], ["uploaded_by_id", "u1"]])).toMatchObject({ data: { isImport: true } });
  });

  it("takes an import_ref as a history field, trimmed and at most 200 characters", () => {
    expect(parse([["file", file], ["import_ref", " glpi:document:42 "]], "changes")).toEqual({ data: { importRef: "glpi:document:42", isImport: true } });
    expect(parse([["file", file], ["import_ref", "x".repeat(201)]])).toHaveProperty("errors.import_ref");
    expect(parse([["file", file], ["import_ref", "  "]])).toHaveProperty("errors.import_ref");
    expect(parse([["file", file], ["import_ref", "a"], ["import_ref", "b"]])).toEqual({ errors: { import_ref: ["Send this field once."] } });
  });

  it("refuses a created_at without offset or in the future", () => {
    expect(parse([["file", file], ["created_at", "2024-03-01T09:30:00"]])).toHaveProperty("errors.created_at");
    expect(parse([["file", file], ["created_at", "2026-11-09T12:00:00Z"]])).toEqual({ errors: { created_at: ["Must not be in the future."] } });
    // A few minutes of clock skew are tolerated.
    expect(parse([["file", file], ["created_at", "2026-11-08T12:03:00Z"]])).toHaveProperty("data");
  });

  it("refuses a file part where text belongs", () => {
    expect(parse([["file", file], ["uploaded_by_id", file]])).toHaveProperty("errors.uploaded_by_id");
  });
});

describe("attachment permissions", () => {
  it("lets any agent write on changes, problems and assets, MANAGER+ on licenses", () => {
    for (const kind of ["change", "problem", "asset"] as const) {
      expect(mayWriteRecordAttachment("USER", kind)).toBe(false);
      expect(mayWriteRecordAttachment("AGENT", kind)).toBe(true);
    }
    expect(mayWriteRecordAttachment("AGENT", "license")).toBe(false);
    expect(mayWriteRecordAttachment("MANAGER", "license")).toBe(true);
    expect(mayWriteRecordAttachment("ADMIN", "license")).toBe(true);
    expect(mayWriteRecordAttachment("bogus", "asset")).toBe(false);
  });

  it("names the staff record an attachment hangs on", () => {
    expect(recordTargetOf({ changeId: 3 })).toBe("change");
    expect(recordTargetOf({ problemId: 1, changeId: null })).toBe("problem");
    expect(recordTargetOf({ assetId: "a" })).toBe("asset");
    expect(recordTargetOf({ licenseId: "l" })).toBe("license");
    expect(recordTargetOf({ changeId: null, problemId: null, assetId: null, licenseId: null })).toBeNull();
  });

  it("closes tickets for new files once closed or cancelled", () => {
    expect(ticketTakesFiles("OPEN")).toBe(true);
    expect(ticketTakesFiles("RESOLVED")).toBe(true);
    expect(ticketTakesFiles("CLOSED")).toBe(false);
    expect(ticketTakesFiles("CANCELLED")).toBe(false);
  });

  it("allows history fields only for import-capable tokens (import:write or admin) of an ADMIN, like /import/*", () => {
    expect(mayImportHistory({ scopes: ["read", "write", "admin"], role: "ADMIN" })).toBe(true);
    expect(mayImportHistory({ scopes: ["read", "write"], role: "ADMIN" })).toBe(false);
    expect(mayImportHistory({ scopes: ["admin"], role: "MANAGER" })).toBe(false);
    expect(mayImportHistory({ scopes: ["import:write"], role: "ADMIN" })).toBe(true);
    expect(mayImportHistory({ scopes: ["tickets:write"], role: "ADMIN" })).toBe(false);
  });
});

describe("upload refusal statuses", () => {
  it("maps size to 413 and type problems to 415", () => {
    const tooBig = validateUpload("a.txt", "text/plain", Buffer.from("hello"), 3);
    expect(tooBig.ok ? null : UPLOAD_ERROR_STATUS[tooBig.code]).toBe(413);
    const exe = validateUpload("setup.exe", "application/x-msdownload", Buffer.from("MZ"));
    expect(exe.ok ? null : UPLOAD_ERROR_STATUS[exe.code]).toBe(415);
    const fakePdf = validateUpload("a.pdf", "application/pdf", Buffer.from("not a pdf"));
    expect(fakePdf.ok ? null : UPLOAD_ERROR_STATUS[fakePdf.code]).toBe(415);
    const empty = validateUpload("a.txt", "text/plain", Buffer.alloc(0));
    expect(empty.ok ? null : UPLOAD_ERROR_STATUS[empty.code]).toBe(422);
  });
});

describe("contentDisposition", () => {
  it("quotes a plain name and repeats it as filename*", () => {
    expect(contentDisposition("report.pdf")).toBe(`attachment; filename="report.pdf"; filename*=UTF-8''report.pdf`);
    expect(contentDisposition("a.png", "inline")).toBe(`inline; filename="a.png"; filename*=UTF-8''a.png`);
  });

  it("encodes non-ASCII per RFC 5987 and keeps the fallback ASCII", () => {
    expect(contentDisposition("Lizenz für opsi.txt")).toBe(`attachment; filename="Lizenz f_r opsi.txt"; filename*=UTF-8''Lizenz%20f%C3%BCr%20opsi.txt`);
  });

  it("percent-encodes characters outside attr-char, incl. quote, apostrophe and parentheses", () => {
    const h = contentDisposition(`a"b'(c)*.txt`);
    expect(h).toBe(`attachment; filename="a_b'(c)*.txt"; filename*=UTF-8''a%22b%27%28c%29%2A.txt`);
  });

  it("never carries a path or a header break", () => {
    const h = contentDisposition("..\\..\\etc/passwd\r\nX-Evil: 1");
    expect(h).not.toMatch(/[\r\n]/);
    expect(h).toBe(`attachment; filename="passwdX-Evil: 1"; filename*=UTF-8''passwdX-Evil%3A%201`);
    expect(contentDisposition("")).toBe(`attachment; filename="file"; filename*=UTF-8''file`);
  });
});
