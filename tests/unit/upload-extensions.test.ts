import { describe, expect, it } from "vitest";
import { EXTRA_EXTENSION_MIME, HARD_DENIED_EXTENSIONS, parseExtraExtensions, validateUpload } from "@/lib/files";
import { UPLOAD_ACCEPT, uploadAccept } from "@/lib/attachments-ui";

const bytes = Buffer.from("not a known signature");
const PDF = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d]);

describe("parseExtraExtensions", () => {
  it("normalizes dots, case, separators and duplicates", () => {
    expect(parseExtraExtensions(" .DWG, step;*.igs\nstep ")).toEqual({ extensions: ["dwg", "step", "igs"], denied: [], invalid: [] });
  });

  it("refuses hard-denied types", () => {
    expect(parseExtraExtensions("dwg, exe, PS1, msi, svg")).toEqual({ extensions: ["dwg"], denied: ["exe", "ps1", "msi", "svg"], invalid: [] });
  });

  it("refuses entries that are not plain extensions", () => {
    expect(parseExtraExtensions("tar.gz, a/b, ok")).toEqual({ extensions: ["ok"], denied: [], invalid: ["tar.gz", "a/b"] });
  });

  it("drops built-in types (they keep their content checks)", () => {
    expect(parseExtraExtensions("pdf, png, dwg").extensions).toEqual(["dwg"]);
  });

  it("is empty for no input", () => {
    expect(parseExtraExtensions(null)).toEqual({ extensions: [], denied: [], invalid: [] });
  });
});

describe("validateUpload with extra extensions", () => {
  it("rejects an unknown type without extras (unchanged default)", () => {
    expect(validateUpload("plan.dwg", "application/acad", bytes)).toEqual({ ok: false, code: "MIME_NOT_ALLOWED" });
  });

  it("accepts an admin-added type as an opaque download, whatever the declared mime", () => {
    expect(validateUpload("Plan 1.DWG", "application/acad", bytes, undefined, ["dwg"])).toEqual({
      ok: true,
      mime: EXTRA_EXTENSION_MIME,
      safeName: "Plan_1.DWG",
    });
    expect(validateUpload("plan.dwg", "", bytes, undefined, ["dwg"])).toMatchObject({ ok: true, mime: EXTRA_EXTENSION_MIME });
  });

  it("never accepts a hard-denied type, even if a stale setting lists it", () => {
    expect(validateUpload("setup.exe", "application/octet-stream", bytes, undefined, ["exe"]).ok).toBe(false);
    expect(validateUpload("invoice.pdf.exe", "application/pdf", PDF, undefined, ["exe"]).ok).toBe(false);
  });

  it("keeps the content check for built-in types", () => {
    expect(validateUpload("fake.pdf", "application/pdf", bytes, undefined, ["pdf"])).toEqual({ ok: false, code: "MAGIC_MISMATCH" });
  });

  it("still enforces the size cap and empty files", () => {
    expect(validateUpload("plan.dwg", "", bytes, 4, ["dwg"])).toEqual({ ok: false, code: "TOO_LARGE" });
    expect(validateUpload("plan.dwg", "", Buffer.alloc(0), undefined, ["dwg"])).toEqual({ ok: false, code: "EMPTY" });
  });

  it("has no overlap between the deny-list and the built-in allow-list", () => {
    for (const ext of ["pdf", "docx", "zip", "txt", "js", "sh", "html", "eml"]) expect(HARD_DENIED_EXTENSIONS.has(ext)).toBe(false);
  });
});

describe("uploadAccept", () => {
  it("adds the extra extensions to the picker hint", () => {
    expect(uploadAccept([])).toBe(UPLOAD_ACCEPT);
    expect(uploadAccept(["dwg", "step"])).toBe(`${UPLOAD_ACCEPT},.dwg,.step`);
  });
});

describe("hard deny-list (Outlook-style blocked types)", () => {
  it.each([
    "iso", "img", "vhd", "vhdx", "chm", "hlp", "cab", "xll", "appref-ms", "diagcab", "search-ms",
    "msh", "mshxml", "ade", "adp", "ins", "isp", "msu", "theme", "ps2",
  ])("never allows .%s as an extra extension", (ext) => {
    expect(HARD_DENIED_EXTENSIONS.has(ext)).toBe(true);
    expect(parseExtraExtensions(`dwg, ${ext}`)).toEqual({ extensions: ["dwg"], denied: [ext], invalid: [] });
  });
});
