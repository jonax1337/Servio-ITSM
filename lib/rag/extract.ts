// Server-only text extraction for Sable Project files (RAG phase 1). Pure JS,
// fully local — no external services. Every extractor is wrapped so a malformed
// or unsupported file degrades to "" instead of throwing. Route by MIME type,
// falling back to the filename extension. Output is capped so a single huge file
// can't blow up chunking / the DB.
import "server-only";

/** Hard cap on extracted characters (~50k tokens). */
const MAX_CHARS = 200_000;

/** Lower-cased file extension without the dot, or "" if none. */
function extOf(filename: string): string {
  const i = filename.lastIndexOf(".");
  return i >= 0 ? filename.slice(i + 1).toLowerCase() : "";
}

const TEXT_EXTS = new Set([
  // docs / data / config
  "txt",
  "text",
  "md",
  "markdown",
  "csv",
  "tsv",
  "json",
  "log",
  "yaml",
  "yml",
  "xml",
  "html",
  "htm",
  "ini",
  "toml",
  "conf",
  "env",
  "css",
  "rtf",
  // code
  "js",
  "mjs",
  "cjs",
  "ts",
  "tsx",
  "jsx",
  "py",
  "rb",
  "go",
  "rs",
  "java",
  "c",
  "h",
  "cpp",
  "cc",
  "cxx",
  "hpp",
  "sh",
  "bash",
  "sql",
]);

const TEXT_MIME_PREFIXES = [
  "application/json",
  "application/xml",
  "application/javascript",
  "application/typescript",
  "application/sql",
  "application/x-yaml",
  "application/x-sh",
  "application/rtf",
];

function looksLikeText(mime: string, ext: string): boolean {
  if (mime.startsWith("text/")) return true;
  if (TEXT_MIME_PREFIXES.includes(mime)) return true;
  if (mime.endsWith("+json") || mime.endsWith("+xml")) return true;
  return TEXT_EXTS.has(ext);
}

async function extractPdf(buf: Buffer): Promise<string> {
  try {
    const { extractText } = await import("unpdf");
    // unpdf expects a Uint8Array; mergePages folds all pages into one string.
    const data = new Uint8Array(buf);
    const { text } = await extractText(data, { mergePages: true });
    return text ?? "";
  } catch {
    return "";
  }
}

async function extractDocx(buf: Buffer): Promise<string> {
  try {
    const mammoth = await import("mammoth");
    const { value } = await mammoth.extractRawText({ buffer: buf });
    return value ?? "";
  } catch {
    return "";
  }
}

/** Plain text of an Office document via officeparser; "" when it can't be parsed. */
export async function extractOfficeText(buf: Buffer): Promise<string> {
  // If the optional native/OCR bits aren't available this throws — treat as a graceful no-op.
  try {
    const { parseOffice } = await import("officeparser");
    const ast = await parseOffice(buf);
    return (await ast.to("text")).value;
  } catch {
    return "";
  }
}

/**
 * Extract plain text from an uploaded project file. Returns "" for anything we
 * can't read (images, binaries, unsupported formats, or extraction failures).
 */
export async function extractText(buf: Buffer, mime: string, filename: string): Promise<string> {
  const ext = extOf(filename);
  const type = (mime || "").toLowerCase();

  let out = "";
  if (looksLikeText(type, ext)) {
    try {
      out = buf.toString("utf8");
    } catch {
      out = "";
    }
  } else if (type === "application/pdf" || ext === "pdf") {
    out = await extractPdf(buf);
  } else if (
    ext === "docx" ||
    type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) {
    out = await extractDocx(buf);
  } else if (
    ext === "pptx" ||
    ext === "xlsx" ||
    type === "application/vnd.openxmlformats-officedocument.presentationml.presentation" ||
    type === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  ) {
    out = await extractOfficeText(buf);
  } else {
    out = "";
  }

  if (out.length > MAX_CHARS) out = out.slice(0, MAX_CHARS);
  return out;
}
