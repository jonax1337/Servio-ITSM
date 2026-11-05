// Content classification for Sable Project files. Pure server helper (NOT a
// "use server" module — it has no client-callable actions; it's imported by the
// upload route handler and the ai-project-files server actions). A fast local
// heuristic by mime/extension always produces a tag; when the AI is configured
// (privacy gate respected) AND there is meaningful extracted text, we refine the
// heuristic via a short classification prompt, falling back to the heuristic on
// any failure or invalid answer. The model is NEVER called when aiConfigured()
// is false.
import "server-only";
import { aiConfigured, generateAiText } from "@/lib/ai";

/** The fixed, shared content-tag vocabulary. */
export const FILE_TAGS = [
  "Documentation",
  "Email",
  "Spreadsheet",
  "Presentation",
  "Image",
  "Contract",
  "Report",
  "Note",
  "Other",
] as const;

export type FileTag = (typeof FILE_TAGS)[number];

/** Lower-cased file extension without the dot, or "" if none. */
function extOf(filename: string): string {
  const i = filename.lastIndexOf(".");
  return i >= 0 ? filename.slice(i + 1).toLowerCase() : "";
}

/**
 * Fast, fully-local classification by mime/extension. Always returns a tag so
 * classification never depends on the AI being available.
 */
function heuristicTag(name: string, mime: string): FileTag {
  const type = (mime || "").toLowerCase();
  const ext = extOf(name);

  if (type.startsWith("image/") || ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "tiff", "heic"].includes(ext)) {
    return "Image";
  }
  if (type.startsWith("message/") || type === "application/vnd.ms-outlook" || ["eml", "msg"].includes(ext)) {
    return "Email";
  }
  if (
    type === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
    type === "application/vnd.ms-excel" ||
    ["xlsx", "xls", "csv", "tsv"].includes(ext)
  ) {
    return "Spreadsheet";
  }
  if (
    type === "application/vnd.openxmlformats-officedocument.presentationml.presentation" ||
    type === "application/vnd.ms-powerpoint" ||
    ["pptx", "ppt"].includes(ext)
  ) {
    return "Presentation";
  }
  if (
    type === "application/pdf" ||
    type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    type === "application/msword" ||
    ["pdf", "docx", "doc", "rtf", "odt"].includes(ext)
  ) {
    return "Documentation";
  }
  if (["md", "markdown", "txt", "text"].includes(ext) || type === "text/markdown" || type === "text/plain") {
    return "Note";
  }
  return "Other";
}

/**
 * Classify a project file into one of FILE_TAGS. Heuristic first (always
 * available), then AI refinement when configured and there is meaningful text.
 */
export async function classifyFile(input: {
  name: string;
  mime: string;
  text?: string | null;
}): Promise<FileTag> {
  const heuristic = heuristicTag(input.name, input.mime);

  const text = (input.text ?? "").trim();
  // No meaningful text (images/binaries) or AI unavailable → keep the heuristic.
  if (text.length < 40) return heuristic;
  if (!(await aiConfigured())) return heuristic;

  try {
    const snippet = text.slice(0, 2000);
    const answer = await generateAiText({
      system:
        "You classify a document into exactly one content tag. Reply with ONLY the tag word, nothing else.",
      prompt:
        `Pick exactly one tag from this list that best describes the document:\n` +
        `${FILE_TAGS.join(", ")}\n\n` +
        `Filename: ${input.name}\n\n` +
        `Content (first part):\n${snippet}`,
    });
    const normalized = answer.trim().replace(/[.\s]+$/, "");
    const match = FILE_TAGS.find((t) => t.toLowerCase() === normalized.toLowerCase());
    return match ?? heuristic;
  } catch {
    return heuristic;
  }
}
