// Pure upload validation — no DB, no fs, no Node-only APIs beyond Buffer.
// Safe to import from route handlers. The server is authoritative; the client
// may pre-check size for UX but never decides what is allowed.

export const MAX_UPLOAD_BYTES = Number(process.env.MAX_UPLOAD_MB ?? 15) * 1024 * 1024;

type Magic = { offset: number; bytes: number[] };
type MimeSpec = { exts: string[]; magic: Magic[] };

// Common magic-byte signatures reused across several MIME entries.
const PK_ZIP: Magic = { offset: 0, bytes: [0x50, 0x4b, 0x03, 0x04] }; // ZIP local file header — docx/xlsx/pptx/odt/… + plain .zip
const OLE2: Magic = { offset: 0, bytes: [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1] }; // legacy MS OLE compound (doc/xls/ppt)

// A comprehensive set of common file types. The security model:
//   - where a reliable magic signature exists (images, PDF, ZIP containers,
//     OLE2 docs, media), we verify it;
//   - for text/code/config, ZIP-container Office/OpenDocument, and OLE2 legacy
//     Office, the magic either can't distinguish siblings or doesn't exist, so
//     we trust the (server-sanitized) extension. `sanitizeFilename` and the
//     app/api/files/[id] UNSAFE_INLINE guard (html/svg/xml/js → octet-stream)
//     keep this safe: nothing here is ever served inline as active content.
//   - SVG is deliberately EXCLUDED (XSS via inline scripts).
export const ALLOWED_MIME: Record<string, MimeSpec> = {
  // ---- Images ----
  "image/png": { exts: ["png"], magic: [{ offset: 0, bytes: [0x89, 0x50, 0x4e, 0x47] }] },
  "image/jpeg": { exts: ["jpg", "jpeg"], magic: [{ offset: 0, bytes: [0xff, 0xd8, 0xff] }] },
  "image/gif": { exts: ["gif"], magic: [{ offset: 0, bytes: [0x47, 0x49, 0x46, 0x38] }] },
  "image/webp": { exts: ["webp"], magic: [{ offset: 0, bytes: [0x52, 0x49, 0x46, 0x46] }] }, // + WEBP@8 checked below
  "image/bmp": { exts: ["bmp"], magic: [{ offset: 0, bytes: [0x42, 0x4d] }] },
  "image/tiff": { exts: ["tif", "tiff"], magic: [{ offset: 0, bytes: [0x49, 0x49, 0x2a, 0x00] }, { offset: 0, bytes: [0x4d, 0x4d, 0x00, 0x2a] }] },
  "image/vnd.microsoft.icon": { exts: ["ico"], magic: [{ offset: 0, bytes: [0x00, 0x00, 0x01, 0x00] }] },
  "image/x-icon": { exts: ["ico"], magic: [{ offset: 0, bytes: [0x00, 0x00, 0x01, 0x00] }] },
  // HEIC/HEIF: ISO-BMFF "ftyp" box at offset 4 (brand varies: heic/heix/mif1/…).
  "image/heic": { exts: ["heic", "heif"], magic: [{ offset: 4, bytes: [0x66, 0x74, 0x79, 0x70] }] },
  "image/heif": { exts: ["heic", "heif"], magic: [{ offset: 4, bytes: [0x66, 0x74, 0x79, 0x70] }] },

  // ---- PDF ----
  "application/pdf": { exts: ["pdf"], magic: [{ offset: 0, bytes: [0x25, 0x50, 0x44, 0x46] }] },

  // ---- Modern Office (OOXML — ZIP containers) ----
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": { exts: ["docx"], magic: [PK_ZIP] },
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": { exts: ["xlsx"], magic: [PK_ZIP] },
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": { exts: ["pptx"], magic: [PK_ZIP] },

  // ---- OpenDocument (also ZIP containers) ----
  "application/vnd.oasis.opendocument.text": { exts: ["odt"], magic: [PK_ZIP] },
  "application/vnd.oasis.opendocument.spreadsheet": { exts: ["ods"], magic: [PK_ZIP] },
  "application/vnd.oasis.opendocument.presentation": { exts: ["odp"], magic: [PK_ZIP] },

  // ---- Legacy Office (OLE2 compound documents) ----
  "application/msword": { exts: ["doc"], magic: [OLE2] },
  "application/vnd.ms-excel": { exts: ["xls"], magic: [OLE2] },
  "application/vnd.ms-powerpoint": { exts: ["ppt"], magic: [OLE2] },

  // ---- Rich text ----
  "application/rtf": { exts: ["rtf"], magic: [{ offset: 0, bytes: [0x7b, 0x5c, 0x72, 0x74, 0x66] }] }, // "{\rtf"
  "text/rtf": { exts: ["rtf"], magic: [{ offset: 0, bytes: [0x7b, 0x5c, 0x72, 0x74, 0x66] }] },

  // ---- Plain text / docs ----
  "text/plain": { exts: ["txt", "log", "md", "markdown", "conf", "ini", "toml", "env", "text"], magic: [] },
  "text/markdown": { exts: ["md", "markdown"], magic: [] },
  "text/csv": { exts: ["csv"], magic: [] },
  "text/tab-separated-values": { exts: ["tsv"], magic: [] },

  // ---- Structured text / config ----
  "application/json": { exts: ["json"], magic: [] },
  "application/xml": { exts: ["xml"], magic: [] },
  "text/xml": { exts: ["xml"], magic: [] },
  "application/x-yaml": { exts: ["yaml", "yml"], magic: [] },
  "text/yaml": { exts: ["yaml", "yml"], magic: [] },
  "text/x-toml": { exts: ["toml"], magic: [] },

  // ---- Web / code (stored only — never served inline; route forces octet-stream) ----
  "text/html": { exts: ["html", "htm"], magic: [] },
  "text/css": { exts: ["css"], magic: [] },
  "text/javascript": { exts: ["js", "mjs", "cjs"], magic: [] },
  "application/javascript": { exts: ["js", "mjs", "cjs"], magic: [] },
  "application/typescript": { exts: ["ts", "tsx"], magic: [] },
  "text/x-python": { exts: ["py"], magic: [] },
  "text/x-ruby": { exts: ["rb"], magic: [] },
  "text/x-go": { exts: ["go"], magic: [] },
  "text/x-rust": { exts: ["rs"], magic: [] },
  "text/x-java-source": { exts: ["java"], magic: [] },
  "text/x-c": { exts: ["c", "h"], magic: [] },
  "text/x-c++": { exts: ["cpp", "cc", "cxx", "hpp"], magic: [] },
  "application/x-sh": { exts: ["sh", "bash"], magic: [] },
  "application/sql": { exts: ["sql"], magic: [] },
  "text/x-sql": { exts: ["sql"], magic: [] },

  // ---- Archives ----
  "application/zip": { exts: ["zip"], magic: [PK_ZIP] },

  // ---- Audio ----
  "audio/mpeg": { exts: ["mp3"], magic: [{ offset: 0, bytes: [0x49, 0x44, 0x33] }, { offset: 0, bytes: [0xff, 0xfb] }, { offset: 0, bytes: [0xff, 0xf3] }, { offset: 0, bytes: [0xff, 0xf2] }] },
  "audio/wav": { exts: ["wav"], magic: [{ offset: 0, bytes: [0x52, 0x49, 0x46, 0x46] }] }, // RIFF (WAVE@8 not enforced)
  "audio/x-wav": { exts: ["wav"], magic: [{ offset: 0, bytes: [0x52, 0x49, 0x46, 0x46] }] },
  "audio/ogg": { exts: ["ogg", "oga"], magic: [{ offset: 0, bytes: [0x4f, 0x67, 0x67, 0x53] }] }, // "OggS"
  "audio/mp4": { exts: ["m4a"], magic: [{ offset: 4, bytes: [0x66, 0x74, 0x79, 0x70] }] }, // ISO-BMFF ftyp
  "audio/x-m4a": { exts: ["m4a"], magic: [{ offset: 4, bytes: [0x66, 0x74, 0x79, 0x70] }] },

  // ---- Video ----
  "video/mp4": { exts: ["mp4", "m4v"], magic: [{ offset: 4, bytes: [0x66, 0x74, 0x79, 0x70] }] }, // ISO-BMFF ftyp
  "video/webm": { exts: ["webm"], magic: [{ offset: 0, bytes: [0x1a, 0x45, 0xdf, 0xa3] }] }, // EBML (mkv/webm)
  "video/quicktime": { exts: ["mov"], magic: [{ offset: 4, bytes: [0x66, 0x74, 0x79, 0x70] }] }, // ISO-BMFF ftyp

  // ---- Raw emails ----
  // Browsers usually send message/rfc822 for .eml; it's text-based (RFC 5322
  // headers) with no reliable magic signature, so trust the extension.
  "message/rfc822": { exts: ["eml"], magic: [] },
};

/**
 * Fallback map: file extension → canonical MIME. Used only when the browser
 * declares `application/octet-stream` (or an empty/unknown type) for a file
 * whose extension we recognise. Lets a known-extension upload persist under its
 * canonical MIME while STILL running the allow-list's magic check against that
 * canonical entry, so no security guarantee is bypassed.
 */
const EXT_TO_MIME: Record<string, string> = (() => {
  const m: Record<string, string> = {};
  for (const [mime, spec] of Object.entries(ALLOWED_MIME)) {
    for (const ext of spec.exts) {
      // First writer wins → the first (canonical) MIME declared for an ext.
      if (!(ext in m)) m[ext] = mime;
    }
  }
  return m;
})();

/** True for generic/empty declared types the browser sends when it can't guess. */
function isGenericMime(mime: string): boolean {
  return mime === "" || mime === "application/octet-stream" || mime === "binary/octet-stream";
}

/** Drop ASCII control chars (< 0x20) and DEL (0x7f) without a control-char regex. */
function stripControl(s: string): string {
  let out = "";
  for (const ch of s) {
    const c = ch.charCodeAt(0);
    if (c >= 0x20 && c !== 0x7f) out += ch;
  }
  return out;
}

/** Make a filename safe: no path separators, control chars, reserved names or traversal. */
export function sanitizeFilename(raw: string): string {
  let name = (raw ?? "").replace(/\\/g, "/");
  name = name.slice(name.lastIndexOf("/") + 1); // basename
  name = stripControl(name.normalize("NFC"));
  // Collapse everything outside the storage-key charset [A-Za-z0-9._-] to "_"
  // (spaces, Unicode letters, punctuation), so the sanitized name is ALWAYS a
  // valid key segment — otherwise storage.put(assertValidKey) would 500 on the
  // majority of real filenames (anything with a space or accent).
  name = name.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/_+/g, "_");
  name = name.replace(/^[._-]+/, ""); // no leading dot/underscore/dash
  name = name.slice(0, 200);
  if (!name || name === "." || name === "..") name = "file";
  return name;
}

function extOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(i + 1).toLowerCase() : "";
}

function magicMatches(data: Buffer, spec: MimeSpec, mime: string): boolean {
  if (spec.magic.length === 0) return true; // text/* — no signature to check
  const ok = spec.magic.some((m) => m.bytes.every((b, i) => data[m.offset + i] === b));
  if (!ok) return false;
  // WebP is "RIFF"....(size)...."WEBP" — verify the container tag at offset 8.
  if (mime === "image/webp") {
    return data.length >= 12 && data.toString("ascii", 8, 12) === "WEBP";
  }
  return true;
}

// ---- Admin-added extensions (Settings › Uploads, env ATTACHMENT_EXTRA_EXTENSIONS) ----
export const ATTACHMENT_EXTRA_EXTENSIONS_SETTING = "ATTACHMENT_EXTRA_EXTENSIONS";

/** Extra types have no magic signature to check, so they are stored and served as opaque downloads. */
export const EXTRA_EXTENSION_MIME = "application/octet-stream";

/**
 * Executable, installer, script and shortcut types that can never be added as an
 * extra extension, whatever the admin configures. (The built-in allow-list's
 * source-code entries — js, sh, py, … — are stored for reference only and always
 * served as downloads; they are not affected.) SVG stays out for the XSS reason
 * noted on ALLOWED_MIME.
 */
export const HARD_DENIED_EXTENSIONS: ReadonlySet<string> = new Set([
  // Windows executables, libraries, installers, control-panel and screensaver files
  "exe", "dll", "com", "scr", "pif", "cpl", "sys", "drv", "ocx", "msi", "msp", "mst", "msc",
  "appx", "appxbundle", "msix", "msixbundle", "application", "gadget", "xbap",
  // Windows scripting hosts and shells
  "bat", "cmd", "ps1", "psm1", "psd1", "ps1xml", "psc1", "vb", "vbs", "vbe", "jse", "wsf", "wsh", "wsc", "ws",
  "hta", "sct", "scf", "reg", "inf", "lnk", "url", "settingcontent-ms", "library-ms",
  "msh", "msh1", "msh2", "mshxml", "msh1xml", "msh2xml", "ps2", "ps2xml", "psc2", "csh", "ksh",
  "appref-ms", "diagcab", "search-ms", "ade", "adp", "mde", "mda", "ins", "isp", "shb", "shs", "osd", "prf", "ops", "printer",
  "website", "webpnp", "theme", "themepack", "msu", "xll", "chm", "hlp", "cab",
  // Disk images and virtual disks Windows mounts on a double click
  "iso", "img", "vhd", "vhdx",
  // Java / cross-platform runtimes
  "jar", "jnlp", "class",
  // macOS / Linux / mobile packages and binaries
  "app", "dmg", "pkg", "command", "run", "bin", "elf", "so", "dylib", "deb", "rpm", "apk", "ipa", "xpi", "crx",
  // Active content that would render inline
  "svg", "svgz", "xhtml", "xht", "mht", "mhtml",
]);

const EXTENSION_SHAPE = /^[a-z0-9][a-z0-9_-]{0,31}$/;

export type ExtraExtensions = {
  /** Usable extensions (lower-case, no dot, not built in, not hard-denied). */
  extensions: string[];
  /** Entries on the hard deny-list — refused, never allowed. */
  denied: string[];
  /** Entries that are not a plain extension. */
  invalid: string[];
};

/** Parse an admin-entered extension list ("dwg, .step igs"). Built-in types are dropped as redundant. */
export function parseExtraExtensions(raw: string | null | undefined): ExtraExtensions {
  const out: ExtraExtensions = { extensions: [], denied: [], invalid: [] };
  const entries = new Set((raw ?? "").split(/[\s,;]+/).map((e) => e.trim().toLowerCase().replace(/^\*?\./, "")).filter(Boolean));
  for (const ext of entries) {
    if (!EXTENSION_SHAPE.test(ext)) out.invalid.push(ext);
    else if (HARD_DENIED_EXTENSIONS.has(ext)) out.denied.push(ext);
    else if (!(ext in EXT_TO_MIME)) out.extensions.push(ext);
  }
  return out;
}

export type ValidationResult =
  | { ok: true; mime: string; safeName: string }
  | { ok: false; code: "TOO_LARGE" | "EMPTY" | "MIME_NOT_ALLOWED" | "EXT_MISMATCH" | "MAGIC_MISMATCH" };

/**
 * Validate an upload against the allow-list. Returns the CANONICAL mime to
 * persist (never the raw client-declared string) and the sanitized filename.
 */
export function validateUpload(
  filename: string,
  declaredMime: string,
  data: Buffer,
  maxBytes: number = MAX_UPLOAD_BYTES,
  extraExtensions: readonly string[] = [],
): ValidationResult {
  if (data.length === 0) return { ok: false, code: "EMPTY" };
  if (data.length > maxBytes) return { ok: false, code: "TOO_LARGE" };

  const safeName = sanitizeFilename(filename);
  const declared = (declaredMime || "").split(";")[0].trim().toLowerCase();
  const ext = extOf(safeName);

  // An admin-added extension: only for types the built-in list does not know (a
  // known type keeps its magic check) and never for a hard-denied one, even if a
  // stale setting still lists it.
  if (ext && !(ext in EXT_TO_MIME) && extraExtensions.includes(ext) && !HARD_DENIED_EXTENSIONS.has(ext)) {
    return { ok: true, mime: EXTRA_EXTENSION_MIME, safeName };
  }

  // When the browser sends a generic/empty type for a known extension, resolve
  // the canonical MIME from the extension. We still validate magic + ext below
  // against that canonical entry, so this never bypasses the allow-list.
  const mime = isGenericMime(declared) && EXT_TO_MIME[ext] ? EXT_TO_MIME[ext] : declared;

  const spec = ALLOWED_MIME[mime];
  if (!spec) return { ok: false, code: "MIME_NOT_ALLOWED" };
  if (!spec.exts.includes(ext)) return { ok: false, code: "EXT_MISMATCH" };
  if (!magicMatches(data, spec, mime)) return { ok: false, code: "MAGIC_MISMATCH" };

  return { ok: true, mime, safeName };
}

/** HTTP status for each upload refusal (shared by the console upload route and the REST API). */
export const UPLOAD_ERROR_STATUS: Record<Extract<ValidationResult, { ok: false }>["code"], 413 | 415 | 422> = {
  TOO_LARGE: 413,
  EMPTY: 422,
  MIME_NOT_ALLOWED: 415,
  EXT_MISMATCH: 415,
  MAGIC_MISMATCH: 415,
};

/** RFC 5987 `attr-char`: everything else in an ext-value must be percent-encoded. */
const ATTR_CHAR = /[A-Za-z0-9!#$&+\-.^_`|~]/;

function rfc5987(value: string): string {
  let out = "";
  for (const byte of Buffer.from(value, "utf8")) {
    const ch = String.fromCharCode(byte);
    out += byte < 0x80 && ATTR_CHAR.test(ch) ? ch : `%${byte.toString(16).toUpperCase().padStart(2, "0")}`;
  }
  return out;
}

/**
 * A `Content-Disposition` header that is safe for any stored filename: the
 * quoted ASCII fallback keeps only printable ASCII (no quote, backslash or
 * path separator, so it can neither break out of the quoted-string nor name a
 * directory), and `filename*` carries the exact name per RFC 5987/6266.
 */
export function contentDisposition(filename: string, disposition: "attachment" | "inline" = "attachment"): string {
  const base = stripControl((filename ?? "").replace(/\\/g, "/")).split("/").pop() || "file";
  const ascii = base.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_") || "file";
  return `${disposition}; filename="${ascii}"; filename*=UTF-8''${rfc5987(base)}`;
}
