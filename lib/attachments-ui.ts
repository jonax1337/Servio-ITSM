// Client-safe attachment helpers — NO Node imports (usable in client components).
import {
  File as FileIcon, FileText, FileImage, FileSpreadsheet, FileType,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

// Client-side mirror of the server's MAX_UPLOAD_MB cap (Admin Settings →
// env fallback). Server pages pass the configured value down as `maxMb`;
// this default only covers callers that weren't given a prop.
export const DEFAULT_MAX_UPLOAD_MB = 15;

/** Byte limit for a configured MB value (pure, client-safe). */
export function maxUploadBytes(mb: number = DEFAULT_MAX_UPLOAD_MB): number {
  return mb * 1024 * 1024;
}

/**
 * `accept` allow-list offered by the file picker. This is a UX hint only — the
 * server's lib/files.ts validateUpload is the authoritative gate. Kept broadly
 * in sync with ALLOWED_MIME; expressed mostly as extensions so browsers that
 * report generic MIME types still surface the right files. SVG is intentionally
 * omitted (matches the server; XSS risk).
 */
export const UPLOAD_ACCEPT = [
  // images
  "image/*",
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".tif", ".tiff", ".ico", ".heic", ".heif",
  // pdf + office (modern, legacy, opendocument)
  ".pdf",
  ".docx", ".xlsx", ".pptx", ".doc", ".xls", ".ppt", ".odt", ".ods", ".odp", ".rtf",
  // text / data / config
  ".txt", ".log", ".md", ".markdown", ".csv", ".tsv", ".json", ".xml",
  ".yaml", ".yml", ".toml", ".ini", ".conf", ".env",
  // web / code
  ".html", ".htm", ".css", ".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx",
  ".py", ".rb", ".go", ".rs", ".java", ".c", ".h", ".cpp", ".cc", ".cxx", ".hpp",
  ".sh", ".bash", ".sql",
  // archives + mail
  ".zip", ".eml",
  // audio / video
  "audio/*", "video/*",
  ".mp3", ".wav", ".ogg", ".oga", ".m4a", ".mp4", ".m4v", ".webm", ".mov",
].join(",");

/** The picker `accept` list including admin-added extensions (Settings › Uploads). */
export function uploadAccept(extraExtensions: readonly string[]): string {
  return extraExtensions.length ? `${UPLOAD_ACCEPT},${extraExtensions.map((e) => `.${e}`).join(",")}` : UPLOAD_ACCEPT;
}

export type AttachmentTarget =
  | { ticketId: number }
  | { commentId: string }
  | { articleId: string }
  | { changeId: number }
  | { problemId: number }
  | { assetId: string }
  | { licenseId: string };

export type AttachmentRow = {
  id: string;
  filename: string;
  mime: string;
  size: number;
  createdAt: Date;
  uploadedById: string | null;
};

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v.toFixed(v < 10 ? 1 : 0)} ${units[i]}`;
}

export function iconForMime(mime: string): LucideIcon {
  if (mime.startsWith("image/")) return FileImage;
  if (mime === "application/pdf") return FileType;
  if (mime.includes("spreadsheet") || mime === "text/csv") return FileSpreadsheet;
  if (mime.startsWith("text/") || mime.includes("word") || mime.includes("presentation")) return FileText;
  return FileIcon;
}
