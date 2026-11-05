import { marked } from "marked";
import DOMPurify from "isomorphic-dompurify";

// GFM, hard line breaks. No raw HTML pass-through beyond what the sanitizer
// below explicitly allows — DOMPurify is the security boundary, not marked.
marked.setOptions({ gfm: true, breaks: true });

// Force every rendered link to open safely, and strip data: URIs on links/media
// (DOMPurify allows data: on <img src> independent of ALLOWED_URI_REGEXP, which
// is a content-spoofing / phishing-overlay surface for portal-facing articles).
//
// EXCEPTION: server-rendered document previews (sanitizeDocumentHtml) legitimately
// carry inline base64 images (docx embeds, etc.). The hook keeps `data:` on <img
// src> ONLY when it matches a strict base64 raster-image allow-list; every other
// data: URI (on any attribute, including <img src> for non-image / non-base64) is
// still stripped. Since DOMPurify runs on one shared singleton, the img exemption
// is universal — but it is narrow (raster image data only), so it does not weaken
// the link/media hardening for comments/articles.
const DATA_IMAGE_OK = /^\s*data:image\/(?:png|jpe?g|gif|webp|bmp|x-icon|vnd\.microsoft\.icon);base64,[a-z0-9+/=\s]+$/i;

let hookInstalled = false;
function installHook() {
  if (hookInstalled) return;
  DOMPurify.addHook("afterSanitizeAttributes", (node) => {
    const href = node.getAttribute?.("href");
    const src = node.getAttribute?.("src");
    if (href && /^\s*data:/i.test(href)) node.removeAttribute("href");
    if (src && /^\s*data:/i.test(src)) {
      // Keep only safe base64 raster images on <img>; strip everything else.
      const isImgTag = node.tagName === "IMG";
      if (!(isImgTag && DATA_IMAGE_OK.test(src))) node.removeAttribute("src");
    }
    if (node.tagName === "A" && node.getAttribute("href")) {
      node.setAttribute("target", "_blank");
      node.setAttribute("rel", "noopener noreferrer nofollow");
    }
  });
  hookInstalled = true;
}

const SANITIZE_CONFIG = {
  ALLOWED_TAGS: [
    "h1", "h2", "h3", "h4", "h5", "h6",
    "p", "br", "hr", "blockquote", "pre", "code",
    "strong", "em", "del", "ins", "mark", "sub", "sup",
    "ul", "ol", "li",
    "a", "img",
    "table", "thead", "tbody", "tr", "th", "td",
    "span", "div",
  ],
  ALLOWED_ATTR: ["href", "title", "alt", "src", "start", "align", "colspan", "rowspan"],
  // Only http(s)/mailto/tel/relative/anchor URLs for most attrs. Note: DOMPurify
  // still permits data: on <img src> regardless of this regexp — the sanitize
  // hook above strips those explicitly. javascript:/vbscript: are blocked here.
  ALLOWED_URI_REGEXP: /^(?:https?:|mailto:|tel:|#|\/(?!\/))/i,
  FORBID_ATTR: ["style", "onerror", "onload", "onclick"],
};

function escapeHtml(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// Stricter config for rich-text comments / ticket descriptions / (future) inbound
// email HTML. Shares the single DOMPurify instance + hook (link/data: hardening).
// The ONE load-bearing line: data-mention-id must be allowed or mention chips die.
const COMMENT_SANITIZE_CONFIG = {
  ALLOWED_TAGS: [
    "h1", "h2", "h3", "h4", "h5", "h6",
    "p", "br", "hr", "blockquote", "pre", "code",
    "strong", "em", "u", "del", "ins", "mark", "sub", "sup",
    "ul", "ol", "li",
    "a", "img",
    "table", "thead", "tbody", "tr", "th", "td",
    "span",
  ],
  ALLOWED_ATTR: ["href", "title", "alt", "src", "width", "height", "start", "colspan", "rowspan"],
  // DOMPurify allows ALL data-*/aria-* by default — turn that off and re-allow
  // ONLY data-mention-id, so an author can't smuggle arbitrary data-* (or forge
  // mention pings) onto stored comment HTML.
  ALLOW_DATA_ATTR: false,
  ALLOW_ARIA_ATTR: false,
  ADD_ATTR: ["data-mention-id"],
  // Because ALLOWED_URI_REGEXP is set, DOMPurify treats data-mention-id as a
  // URI-valued attr and would drop the cuid (fails the regex) — killing every
  // mention chip. ADD_URI_SAFE_ATTR exempts it from that URI check.
  ADD_URI_SAFE_ATTR: ["data-mention-id"],
  ALLOWED_URI_REGEXP: /^(?:https?:|mailto:|tel:|#|\/(?!\/))/i,
  FORBID_ATTR: ["style", "class", "id", "srcset", "contenteditable", "onerror", "onload", "onclick"],
  FORBID_TAGS: ["style", "script", "iframe", "object", "embed", "form", "input", "link", "meta", "base"],
};

/** Sanitize rich-text HTML (comments/descriptions/email). The real security boundary. */
export function sanitizeCommentHtml(dirty: string): string {
  installHook();
  return DOMPurify.sanitize(dirty ?? "", COMMENT_SANITIZE_CONFIG);
}

// Config for SERVER-GENERATED document previews (docx/xlsx/csv → HTML). Wider than
// the article set: allows document structure + inline base64 images + class/span/div
// so office converters keep their layout hooks. Still hard-blocks script/iframe/
// object/embed/style/form/link/meta/base and all on* handlers. `data:` is permitted
// in the URI regexp so DOMPurify doesn't pre-strip <img src=data:…>; the shared
// afterSanitizeAttributes hook then narrows data: to base64 raster images only and
// strips it from every other attribute/tag.
const DOCUMENT_SANITIZE_CONFIG = {
  ALLOWED_TAGS: [
    "h1", "h2", "h3", "h4", "h5", "h6",
    "p", "br", "hr", "blockquote", "pre", "code",
    "strong", "b", "em", "i", "u", "s", "del", "ins", "mark", "sub", "sup", "small",
    "ul", "ol", "li",
    "a", "img",
    "table", "thead", "tbody", "tfoot", "tr", "th", "td", "caption", "colgroup", "col",
    "span", "div", "section", "article", "figure", "figcaption",
  ],
  ALLOWED_ATTR: [
    "href", "title", "alt", "src", "start", "align",
    "colspan", "rowspan", "width", "height", "class", "span",
  ],
  // Permit data: here so <img src=data:…> survives DOMPurify's own URI check; the
  // hook re-validates it against the base64 raster-image allow-list.
  ALLOWED_URI_REGEXP: /^(?:https?:|mailto:|tel:|#|data:image\/|\/(?!\/))/i,
  FORBID_TAGS: ["script", "iframe", "object", "embed", "form", "input", "style", "link", "meta", "base"],
  FORBID_ATTR: ["style", "srcset", "onerror", "onload", "onclick", "contenteditable"],
};

/**
 * Sanitize SERVER-GENERATED document HTML (from mammoth/SheetJS/csv → HTML) for
 * in-app preview rendering. Keeps document structure + inline base64 raster images;
 * strips all scripting/embedding vectors. NEVER pass raw user-authored HTML here —
 * use sanitizeCommentHtml for that (this config is deliberately more permissive).
 */
export function sanitizeDocumentHtml(dirty: string): string {
  installHook();
  return DOMPurify.sanitize(dirty ?? "", DOCUMENT_SANITIZE_CONFIG);
}

/** Derive plaintext from ALREADY-sanitized HTML (search/notifications/mailer). */
export function htmlToText(html: string): string {
  return (html ?? "")
    .replace(/<(?:br|hr)\s*\/?>/gi, "\n")
    .replace(/<li[^>]*>/gi, "\n- ")
    .replace(/<\/(?:p|div|h[1-6]|li|tr|blockquote|pre)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Read a rich-text comment body from a form: sanitized HTML + derived plaintext
 * twin. Falls back to plain `body` for legacy/plaintext posts.
 */
export function readRichBody(formData: FormData): { body: string; bodyHtml: string | null } {
  const rawHtml = formData.get("bodyHtml");
  if (typeof rawHtml === "string" && rawHtml.trim()) {
    const bodyHtml = sanitizeCommentHtml(rawHtml);
    return { body: htmlToText(bodyHtml).trim(), bodyHtml };
  }
  return { body: String(formData.get("body") ?? "").trim(), bodyHtml: null };
}

/** Generic twin reader for any {textKey, htmlKey} pair (e.g. description/descriptionHtml). */
export function readRichField(
  formData: FormData,
  htmlKey: string,
  textKey: string,
): { text: string; html: string | null } {
  const raw = formData.get(htmlKey);
  if (typeof raw === "string" && raw.trim()) {
    const html = sanitizeCommentHtml(raw);
    return { text: htmlToText(html).trim(), html };
  }
  return { text: String(formData.get(textKey) ?? "").trim(), html: null };
}

/** Extract the exact user ids from mention chips (data-mention-id) in sanitized HTML. */
export function parseMentionIds(html: string): string[] {
  const ids = new Set<string>();
  const re = /data-mention-id="([^"]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html ?? "")) !== null) ids.add(m[1]);
  return [...ids];
}

/**
 * Render an article body to trusted, sanitized HTML.
 * Works identically on the server (article view) and client (editor preview),
 * so what the author previews is exactly what readers get.
 */
export function renderMarkdown(source: string, format: string = "markdown"): string {
  installHook();
  const raw =
    format === "plain"
      ? escapeHtml(source).replace(/\n/g, "<br>")
      : (marked.parse(source ?? "", { async: false }) as string);
  return DOMPurify.sanitize(raw, SANITIZE_CONFIG);
}
