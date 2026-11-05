"use client";

import { useCallback, useMemo, useState } from "react";
import { Boxes, Check, Copy, Download, FolderPlus, Loader2, MessageSquarePlus, Save, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { SableMark } from "@/components/sable-mark";
import dynamic from "next/dynamic";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { renderMarkdown, sanitizeDocumentHtml, htmlToText } from "@/lib/markdown";
import { cn } from "@/lib/utils";
import { useSable } from "./sable-provider";

// The WASM-engine code highlighter is heavy; load it only when the canvas shows
// code. Until it's ready, show the raw code in a plain <pre> (no layout jump).
const CanvasCode = dynamic(() => import("./canvas-code"), {
  ssr: false,
  loading: () => null,
});
import { ProposalCard, type ProposalStatus } from "./proposal-card";
import { saveArtifactToProject } from "@/lib/actions/ai-project-files";
import { listProjects, type AssistantProposal, type ProjectSummary } from "@/lib/actions/ai-assistant";

/** Map a language hint → a file extension for a saved artifact. */
const LANG_EXT: Record<string, string> = {
  bash: "sh",
  sh: "sh",
  shell: "sh",
  powershell: "ps1",
  ps1: "ps1",
  pwsh: "ps1",
  bat: "bat",
  batch: "bat",
  cmd: "cmd",
  python: "py",
  py: "py",
  ruby: "rb",
  go: "go",
  rust: "rs",
  java: "java",
  c: "c",
  "c++": "cpp",
  cpp: "cpp",
  javascript: "js",
  js: "js",
  typescript: "ts",
  ts: "ts",
  sql: "sql",
  json: "json",
  yaml: "yaml",
  yml: "yaml",
  toml: "toml",
  xml: "xml",
  html: "html",
  css: "css",
  dockerfile: "dockerfile",
  markdown: "md",
  md: "md",
};

/** File extensions we treat as CODE (raw monospace, never rich text). */
const CODE_EXTS = new Set([
  "sh", "ps1", "bat", "cmd", "py", "rb", "go", "rs", "java", "c", "cpp", "cc",
  "h", "hpp", "js", "mjs", "cjs", "ts", "tsx", "jsx", "sql", "json", "yaml",
  "yml", "toml", "ini", "xml", "html", "htm", "css", "pl", "php", "dockerfile",
]);

/** The lowercase extension of a filename (without the dot), or "". */
function fileExt(name?: string): string {
  if (!name) return "";
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(i + 1).toLowerCase() : "";
}

/**
 * A draft is CODE (shown in a plain monospace editor, saved verbatim) when its
 * language or filename points at a code type — anything but a prose document
 * (markdown/plain text), which stays in the rich-text editor.
 */
function isCodeDoc(doc: { language?: string; filename?: string }): boolean {
  const lang = (doc.language ?? "").trim().toLowerCase();
  if (lang) {
    const ext = LANG_EXT[lang] ?? lang;
    if (ext !== "md" && ext !== "txt" && CODE_EXTS.has(ext)) return true;
  }
  const fext = fileExt(doc.filename);
  return !!fext && CODE_EXTS.has(fext);
}

/**
 * Pull the runnable code out of a code draft: if the model wrapped it in fenced
 * ``` blocks (often with prose between/around them), keep ONLY the block bodies
 * so the canvas shows a clean script — not the surrounding explanation. Falls
 * back to the trimmed text when there are no fences.
 */
function extractCode(markdown: string): string {
  const blocks = [...markdown.matchAll(/```[^\n]*\n([\s\S]*?)```/g)].map((m) =>
    m[1].replace(/\n+$/, ""),
  );
  if (blocks.length) return blocks.join("\n\n");
  return markdown.trim();
}

/** Turn a title into a filesystem-friendly slug (letters/digits/dashes). */
function slugify(s: string): string {
  const slug = s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return slug || "document";
}

/**
 * Derive a sensible saved filename for the artifact: prefer the model-supplied
 * `filename`, else slugify the title + an extension inferred from `language`
 * (default `.md`).
 */
function artifactFilename(doc: { title: string; filename?: string; language?: string }): string {
  if (doc.filename && doc.filename.trim()) return doc.filename.trim();
  const lang = (doc.language ?? "").trim().toLowerCase();
  const ext = LANG_EXT[lang] ?? "md";
  return `${slugify(doc.title)}.${ext}`;
}

/** Map a language/extension hint → a Shiki grammar name for read-only render. */
const SHIKI_LANG: Record<string, string> = {
  sh: "bash", shell: "bash", bash: "bash",
  ps1: "powershell", powershell: "powershell", pwsh: "powershell",
  bat: "batch", cmd: "batch", batch: "batch",
  py: "python", python: "python",
  rb: "ruby", ruby: "ruby",
  go: "go", rs: "rust", rust: "rust", java: "java",
  c: "c", cpp: "cpp", "c++": "cpp", cc: "cpp",
  js: "javascript", mjs: "javascript", cjs: "javascript", jsx: "jsx",
  ts: "typescript", tsx: "tsx", javascript: "javascript", typescript: "typescript",
  sql: "sql", json: "json", yaml: "yaml", yml: "yaml", toml: "toml", ini: "ini",
  xml: "xml", html: "html", htm: "html", css: "css",
  dockerfile: "docker", docker: "docker", md: "markdown", markdown: "markdown",
};

/** A human label for the artifact type badge (e.g. "PowerShell", "Markdown"). */
const LANG_LABEL: Record<string, string> = {
  bash: "Shell", powershell: "PowerShell", batch: "Batch", python: "Python",
  ruby: "Ruby", go: "Go", rust: "Rust", java: "Java", c: "C", cpp: "C++",
  javascript: "JavaScript", jsx: "JSX", typescript: "TypeScript", tsx: "TSX",
  sql: "SQL", json: "JSON", yaml: "YAML", toml: "TOML", ini: "INI",
  xml: "XML", html: "HTML", css: "CSS", docker: "Dockerfile", markdown: "Markdown",
};

function shikiLangFor(doc: { language?: string; filename?: string }): string {
  const lang = (doc.language ?? "").trim().toLowerCase();
  if (lang && SHIKI_LANG[lang]) return SHIKI_LANG[lang];
  const ext = fileExt(doc.filename);
  return SHIKI_LANG[ext] ?? "text";
}

/**
 * The Artifacts / Canvas side panel — a clean, READ-ONLY view of what Sable
 * drafted (like Claude's artifacts): a script or file renders as syntax-
 * highlighted code, a prose document as rendered markdown. Nothing is edited in
 * place; the user reads it, copies or downloads it, saves it into a project, or
 * (for prose) publishes it as a Knowledge Base article — the latter through the
 * approve-first proposal path (re-validated server-side by applyAssistantProposal).
 * To change an artifact the user asks Sable, which re-drafts it.
 *
 * Session-only (no DB): the draft lives on the provider for the window session.
 */
export function SableCanvas() {
  const sable = useSable();
  const doc = sable.canvasDoc;

  const preview = !!doc?.preview;
  // A pre-rendered HTML body (proposal preview) is never treated as code.
  const isCode = useMemo(() => (doc && !doc.html ? isCodeDoc(doc) : false), [doc]);
  // Code → the runnable body (prose/fences stripped). Prose → rendered markdown,
  // or a supplied HTML body rendered as-is (both DOMPurify-sanitised).
  const code = useMemo(() => (doc && isCode ? extractCode(doc.markdown) : ""), [doc, isCode]);
  const proseHtml = useMemo(() => {
    if (!doc || isCode) return "";
    return doc.html ? sanitizeDocumentHtml(doc.html) : renderMarkdown(doc.markdown, "markdown");
  }, [doc, isCode]);
  const shikiLang = useMemo(() => (doc ? shikiLangFor(doc) : "text"), [doc]);
  const badge = isCode ? LANG_LABEL[shikiLang] ?? "Code" : "Document";

  const [copied, setCopied] = useState(false);
  const [publishing, setPublishing] = useState(false);

  // The verbatim artifact content (raw code, source markdown, or plain text of an
  // HTML body) — for copy / download / insert.
  const rawContent = useCallback(
    () => (isCode ? code : doc?.html ? htmlToText(doc.html) : doc?.markdown ?? ""),
    [isCode, code, doc],
  );

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(rawContent());
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Couldn't copy to the clipboard.");
    }
  }, [rawContent]);

  const insert = useCallback(() => {
    const text = rawContent();
    if (!text.trim()) return;
    sable.insertIntoComposer(text);
    toast.success("Added to the chat composer.");
  }, [sable, rawContent]);

  // Download the artifact as its file (no server round-trip; the draft is local).
  const download = useCallback(() => {
    if (!doc) return;
    const text = rawContent();
    if (!text.trim()) return;
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = artifactFilename(doc);
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }, [doc, rawContent]);

  if (!doc) return null;

  return (
    <aside className="hidden min-h-0 w-[440px] shrink-0 flex-col border-l bg-muted/10 lg:flex xl:w-[520px]">
      <header className="flex items-center gap-2.5 border-b px-3 py-2.5">
        <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-sable text-sable-foreground">
          <SableMark className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              {preview ? "Preview" : isCode ? artifactFilename(doc) : "Canvas"}
            </p>
            <span className="rounded bg-muted px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-muted-foreground">
              {badge}
            </span>
          </div>
          <p className="truncate font-display text-sm font-semibold leading-tight tracking-tight text-foreground">
            {doc.title}
          </p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Close canvas"
          onClick={sable.closeCanvas}
        >
          <X className="size-4" />
        </Button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {isCode ? (
          <div className="p-3 text-[13px]">
            <CanvasCode code={code} language={shikiLang} showLineNumbers />
          </div>
        ) : (
          <div
            className="prose prose-sm dark:prose-invert max-w-none px-4 py-3.5 prose-headings:font-display prose-pre:bg-muted/40"
            // Sanitised by renderMarkdown (DOMPurify) before it reaches the DOM.
            dangerouslySetInnerHTML={{ __html: proseHtml }}
          />
        )}
      </div>

      <footer className="flex flex-col gap-2 border-t px-3 py-2.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={copy}>
            {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
            {copied ? "Copied" : "Copy"}
          </Button>
          <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={download}>
            <Download className="size-3.5" />
            Download
          </Button>
          {/* A proposal preview is read-only: only Copy / Download / Close. The
              write-actions belong to the approval card, not the preview. */}
          {!preview ? (
            <>
              <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={insert}>
                <MessageSquarePlus className="size-3.5" />
                Insert into chat
              </Button>
              <SaveToProjectMenu
                filename={artifactFilename(doc)}
                getContent={rawContent}
                defaultProjectId={sable.projectId}
              />
            </>
          ) : null}
          {/* A script isn't a KB article — only offer publishing for prose docs. */}
          {!isCode && !preview ? (
            <Button
              type="button"
              size="sm"
              className={cn("gap-1.5 bg-sable text-sable-foreground hover:bg-sable/90", publishing && "opacity-70")}
              onClick={() => setPublishing((p) => !p)}
            >
              <Save className="size-3.5" />
              Save as KB article
            </Button>
          ) : null}
        </div>

        {publishing && !isCode ? (
          <SableCanvasPublish title={doc.title} html={proseHtml} />
        ) : null}
      </footer>
    </aside>
  );
}

/**
 * "Save to project" from the canvas: a project picker so an artifact can land in
 * ANY of the user's projects — not only when the current chat is project-bound.
 * The chat's own project (if any) is listed first and marked "current". Persists
 * the currently-edited content (raw code, or the prose text) via
 * `saveArtifactToProject`, which access-checks the target project server-side.
 */
function SaveToProjectMenu({
  filename,
  getContent,
  defaultProjectId,
}: {
  filename: string;
  getContent: () => string;
  defaultProjectId: string | null;
}) {
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);

  const load = useCallback(() => {
    if (projects || loading) return;
    setLoading(true);
    listProjects()
      .then((rows) => setProjects(rows.filter((p) => !p.archived)))
      .catch(() => setProjects([]))
      .finally(() => setLoading(false));
  }, [projects, loading]);

  const save = useCallback(
    async (projectId: string, projectName: string) => {
      const content = getContent();
      if (!content.trim()) {
        toast.error("Nothing to save.");
        return;
      }
      setSavingId(projectId);
      try {
        const res = await saveArtifactToProject(projectId, { name: filename, content });
        if (res.ok) toast.success(`Saved “${res.file.name}” to ${projectName}.`);
        else toast.error(res.error || "Couldn't save to the project.");
      } catch {
        toast.error("Couldn't save to the project.");
      } finally {
        setSavingId(null);
      }
    },
    [filename, getContent],
  );

  // The chat's bound project floats to the top (marked "current").
  const ordered = useMemo(() => {
    if (!projects) return [];
    const rank = (p: ProjectSummary) => (p.id === defaultProjectId ? 0 : 1);
    return [...projects].sort((a, b) => rank(a) - rank(b));
  }, [projects, defaultProjectId]);

  return (
    <DropdownMenu onOpenChange={(open) => open && load()}>
      <DropdownMenuTrigger
        render={<Button type="button" variant="outline" size="sm" className="gap-1.5" />}
      >
        <FolderPlus className="size-3.5" />
        Save to project
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-72 min-w-52">
        {loading ? (
          <DropdownMenuItem disabled>
            <Loader2 className="size-3.5 animate-spin" /> Loading…
          </DropdownMenuItem>
        ) : null}
        {!loading && ordered.length === 0 ? (
          <DropdownMenuItem disabled>No projects yet</DropdownMenuItem>
        ) : null}
        {ordered.map((p) => (
          <DropdownMenuItem
            key={p.id}
            disabled={savingId !== null}
            onClick={() => save(p.id, p.name)}
          >
            <Boxes className="size-3.5" />
            <span className="min-w-0 truncate">{p.name}</span>
            {p.id === defaultProjectId ? (
              <span className="ml-auto shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground">
                current
              </span>
            ) : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * "Save as KB article" reuses Sable's approve-first path: we synthesise an
 * `article.create` proposal (body = the edited HTML) and render the SAME
 * ProposalCard the chat uses. Approve routes through applyAssistantProposal,
 * which re-checks the agent's role + re-validates the args server-side, so no
 * bespoke write path is introduced. The article lands as a DRAFT.
 *
 * Note: approval requires a saved conversation to authorise against; when the
 * chat hasn't been created yet (fresh, unsent), we prompt the user to send a
 * message first (a one-line hint) rather than fail on approve.
 */
function SableCanvasPublish({ title, html }: { title: string; html: string }) {
  const sable = useSable();
  const conversationId = sable.conversationId;

  const proposal = useMemo<AssistantProposal>(
    () => ({
      id: "canvas-article",
      operationId: "article.create",
      args: { title, body: html, visibility: "INTERNAL" },
      label: `Create article “${title}”`,
      // One id per shown draft: a double click applies once, publishing a new draft applies again.
      toolCallId: `canvas-${crypto.randomUUID()}`,
    }),
    [title, html],
  );

  const [status, setStatus] = useState<ProposalStatus>({ status: "idle" });

  if (!conversationId) {
    return (
      <p className="rounded-lg bg-muted/50 px-2.5 py-2 text-[11px] text-muted-foreground">
        Send a message in the chat first, then you can publish this draft as a
        Knowledge Base article.
      </p>
    );
  }

  return (
    <ProposalCard
      conversationId={conversationId}
      proposal={proposal}
      status={status}
      onStatusChange={setStatus}
    />
  );
}
