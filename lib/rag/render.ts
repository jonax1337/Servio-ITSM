// Server-only RICH preview rendering for uploaded files. Unlike lib/rag/extract.ts
// (which yields plain text for RAG indexing), this produces SANITIZED HTML meant
// to be rendered in the file-preview lightbox — real tables for spreadsheets, real
// formatting for Word docs, etc. Every converter is wrapped so a malformed or
// unsupported file degrades to { kind: "none" } instead of throwing.
//
// Native-renderable types (pdf/image/audio/video) return { kind: "none" } here on
// purpose: the lightbox embeds those directly and never round-trips this helper.
import "server-only";
import { renderMarkdown, sanitizeDocumentHtml } from "@/lib/markdown";
import { extractOfficeText } from "@/lib/rag/extract";

/** Hard cap on produced HTML (post-sanitize) so one huge sheet can't blow up the client. */
const MAX_HTML_CHARS = 2_000_000;

export type RenderedFile = { kind: "html"; html: string } | { kind: "none" };

/** Lower-cased file extension without the dot, or "" if none. */
function extOf(filename: string): string {
  const i = filename.lastIndexOf(".");
  return i >= 0 ? filename.slice(i + 1).toLowerCase() : "";
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Wrap already-escaped/plain text in a scrollable <pre>, then sanitize. */
function preHtml(text: string): string {
  return sanitizeDocumentHtml(`<pre>${escapeHtml(text)}</pre>`);
}

const MARKDOWN_EXTS = new Set(["md", "markdown", "mdown", "mkd"]);
// Code / structured text we render as an escaped <pre>. (No server-side shiki: the
// app's highlighter is client-only `react-shiki/web`; plain <pre> keeps this Node-safe.)
const CODE_EXTS = new Set([
  "txt", "log", "text", "csv", "tsv", "json", "xml", "yaml", "yml", "toml", "ini",
  "conf", "env", "properties", "eml", "html", "htm", "css", "scss", "less",
  "js", "jsx", "mjs", "cjs", "ts", "tsx", "py", "rb", "go", "rs", "java", "kt",
  "c", "h", "cpp", "hpp", "cc", "cs", "php", "sh", "bash", "zsh", "ps1", "sql",
  "graphql", "gql", "diff", "patch", "dockerfile", "makefile",
]);

function looksLikeText(mime: string, ext: string): boolean {
  if (mime.startsWith("text/")) return true;
  if (mime === "application/json" || mime === "application/xml") return true;
  if (mime.endsWith("+json") || mime.endsWith("+xml")) return true;
  if (mime === "message/rfc822") return true;
  return CODE_EXTS.has(ext) || MARKDOWN_EXTS.has(ext);
}

async function renderDocx(buf: Buffer): Promise<RenderedFile> {
  try {
    const mammoth = await import("mammoth");
    const { value } = await mammoth.convertToHtml({ buffer: buf });
    const html = (value ?? "").trim();
    if (!html) return { kind: "none" };
    return { kind: "html", html: sanitizeDocumentHtml(html) };
  } catch {
    return { kind: "none" };
  }
}

async function renderXlsx(buf: Buffer): Promise<RenderedFile> {
  try {
    const XLSX = await import("xlsx");
    const wb = XLSX.read(buf, { type: "buffer" });
    const parts: string[] = [];
    for (const name of wb.SheetNames) {
      const ws = wb.Sheets[name];
      if (!ws) continue;
      const table = XLSX.utils.sheet_to_html(ws, { id: "", editable: false });
      parts.push(
        `<section><h2>${escapeHtml(name)}</h2>${table}</section>`,
      );
    }
    if (parts.length === 0) return { kind: "none" };
    return { kind: "html", html: sanitizeDocumentHtml(parts.join("\n")) };
  } catch {
    return { kind: "none" };
  }
}

/** Minimal RFC-4180-ish CSV parser (handles quotes, escaped quotes, embedded newlines). */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field); field = "";
    } else if (ch === "\r") {
      // swallow; a following \n ends the row
    } else if (ch === "\n") {
      row.push(field); field = "";
      rows.push(row); row = [];
    } else field += ch;
  }
  // flush trailing field/row (unless the file ended on a clean newline)
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}

function renderCsv(buf: Buffer): RenderedFile {
  try {
    const text = buf.toString("utf8");
    const rows = parseCsv(text).filter((r) => r.length > 0 && !(r.length === 1 && r[0] === ""));
    if (rows.length === 0) return { kind: "none" };
    const [head, ...body] = rows;
    const thead =
      `<thead><tr>${head.map((c) => `<th>${escapeHtml(c)}</th>`).join("")}</tr></thead>`;
    const tbody =
      `<tbody>${body
        .map((r) => `<tr>${r.map((c) => `<td>${escapeHtml(c)}</td>`).join("")}</tr>`)
        .join("")}</tbody>`;
    return { kind: "html", html: sanitizeDocumentHtml(`<table>${thead}${tbody}</table>`) };
  } catch {
    return { kind: "none" };
  }
}

// pptx / legacy doc/ppt: no clean HTML converter here (officeparser yields text only).
// Best-effort — render its extracted text as a readable <pre>. NOT pixel-perfect:
// slide layout, images, and styling are lost; this is a text fallback, not a viewer.
async function renderOfficeText(buf: Buffer): Promise<RenderedFile> {
  const text = (await extractOfficeText(buf)).trim();
  return text ? { kind: "html", html: preHtml(text) } : { kind: "none" };
}

/**
 * Render an uploaded file to sanitized preview HTML.
 *  - docx → mammoth HTML
 *  - xlsx/xls → one HTML table per sheet
 *  - csv → HTML table
 *  - md/markdown → renderMarkdown
 *  - text/code/json/xml/yaml/log/eml/… → escaped <pre>
 *  - pptx / legacy doc/ppt → best-effort extracted text in a <pre>
 *  - pdf/image/audio/video → { kind: "none" } (native lightbox render)
 *  - everything else → { kind: "none" }
 */
export async function renderFileHtml(input: {
  mime: string;
  name: string;
  buf: Buffer;
}): Promise<RenderedFile> {
  const mime = (input.mime || "").toLowerCase();
  const ext = extOf(input.name);
  const buf = input.buf;

  // Natively rendered by the lightbox — nothing to do here.
  if (
    mime === "application/pdf" ||
    ext === "pdf" ||
    mime.startsWith("image/") ||
    mime.startsWith("audio/") ||
    mime.startsWith("video/")
  ) {
    return { kind: "none" };
  }

  let out: RenderedFile;

  if (MARKDOWN_EXTS.has(ext) || mime === "text/markdown") {
    out = { kind: "html", html: renderMarkdown(buf.toString("utf8"), "markdown") };
  } else if (
    ext === "docx" ||
    mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) {
    out = await renderDocx(buf);
  } else if (
    ext === "xlsx" ||
    ext === "xls" ||
    ext === "xlsm" ||
    ext === "xlsb" ||
    ext === "ods" ||
    mime === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
    mime === "application/vnd.ms-excel"
  ) {
    out = await renderXlsx(buf);
  } else if (ext === "csv" || mime === "text/csv") {
    out = renderCsv(buf);
  } else if (
    ext === "pptx" ||
    ext === "ppt" ||
    ext === "doc" ||
    ext === "odp" ||
    ext === "odt" ||
    mime === "application/vnd.openxmlformats-officedocument.presentationml.presentation" ||
    mime === "application/vnd.ms-powerpoint" ||
    mime === "application/msword"
  ) {
    out = await renderOfficeText(buf);
  } else if (looksLikeText(mime, ext)) {
    out = { kind: "html", html: preHtml(buf.toString("utf8")) };
  } else {
    out = { kind: "none" };
  }

  if (out.kind === "html" && out.html.length > MAX_HTML_CHARS) {
    out = { kind: "html", html: out.html.slice(0, MAX_HTML_CHARS) };
  }
  return out;
}
