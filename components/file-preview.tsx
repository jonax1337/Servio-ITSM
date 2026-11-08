"use client";

// Reusable file-preview lightbox used across the whole app (tickets, comments,
// portal, Sable project library). Serves previewable files inline via the
// /api/files/[id]?inline=1 route; falls back to a friendly download prompt.
import * as React from "react";
import { Download, Loader2, X, ChevronLeft, ChevronRight } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button, buttonVariants } from "@/components/ui/button";
import { Dialog, DialogPortal, DialogOverlay } from "@/components/ui/dialog";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { formatBytes, iconForMime } from "@/lib/attachments-ui";
import { useT } from "@/lib/i18n/client";

/** English source of the preview errors; DocumentView shows them translated. */
const NO_INLINE_PREVIEW = "No inline preview for this file";
const LOAD_FAILED = "Failed to load preview";

export type PreviewFile = {
  id: string;
  name: string;
  mime: string;
  size?: number;
  extractedText?: string | null;
};

const MAX_TEXT_CHARS = 200_000;

type PreviewKind =
  | "image"
  | "pdf"
  | "audio"
  | "video"
  | "document"
  | "extracted"
  | "none";

// Documents we render as REAL HTML via /api/files/[id]/preview (docx tables, xlsx
// sheets, csv tables, markdown, code/text in a <pre>). Images/pdf/audio/video embed
// natively; office-with-only-extracted-text falls back to the extracted <pre>.
const DOC_MIME =
  /^(text\/|application\/(json|xml|x-yaml|yaml|x-sh|javascript|ecmascript|csv))|message\/rfc822|(word|officedocument|opendocument|ms-?excel|ms-?powerpoint|spreadsheet|presentation|msword)/i;
const DOC_EXT =
  /\.(txt|text|md|markdown|mdown|mkd|csv|tsv|json|log|ya?ml|toml|ini|conf|env|xml|eml|html?|css|scss|less|jsx?|mjs|cjs|tsx?|py|rb|go|rs|java|kt|c|h|cpp|hpp|cc|cs|php|sh|bash|zsh|ps1|sql|graphql|gql|diff|patch|docx?|xlsx?|xlsm|xlsb|pptx?|od[tps])$/i;

// iconForMime returns one of a few stable module-level lucide components; use
// React.createElement so we don't assign it to a capitalized local (which the
// static-components rule reads as creating a component during render).
function MimeIcon({ mime, className }: { mime: string; className?: string }) {
  return React.createElement(iconForMime(mime), { className });
}

function classify(file: PreviewFile): PreviewKind {
  const mime = file.mime || "";
  // Guard: html/svg/xml-as-html blobs are never rendered inline (route forces
  // download); the .html/.xml EXTENSIONS below route through the preview endpoint,
  // which serves sanitized HTML (not the raw blob), so they are safe.
  if (mime.startsWith("image/") && !mime.includes("svg")) return "image";
  if (mime === "application/pdf") return "pdf";
  if (mime.startsWith("audio/")) return "audio";
  if (mime.startsWith("video/")) return "video";
  if (DOC_MIME.test(mime) || DOC_EXT.test(file.name)) return "document";
  if (file.extractedText) return "extracted";
  return "none";
}

function inlineUrl(id: string): string {
  return `/api/files/${id}?inline=1`;
}
function downloadUrl(id: string): string {
  return `/api/files/${id}`;
}
function previewUrl(id: string): string {
  return `/api/files/${id}/preview`;
}

type DocState = {
  loading: boolean;
  html: string | null;
  /** A faithful PDF render (Gotenberg) to embed in an iframe, when available. */
  pdfUrl: string | null;
  /** Extracted-text fallback used when the rich preview is unavailable. */
  fallbackText: string | null;
  error: string | null;
};

// Lazily fetch the SANITIZED preview HTML for the "document" kind. Falls back to the
// server-extracted text (rendered as a <pre>) when the endpoint returns no content
// (204) or errors — so a preview always shows something if we have extracted text.
function useDocumentHtml(file: PreviewFile, kind: PreviewKind, open: boolean): DocState {
  const [state, setState] = React.useState<DocState>({
    loading: false,
    html: null,
    pdfUrl: null,
    fallbackText: null,
    error: null,
  });

  React.useEffect(() => {
    if (!open || kind !== "document") {
      // intentional: reset the async preview state when closed / not a document.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setState({ loading: false, html: null, pdfUrl: null, fallbackText: null, error: null });
      return;
    }
    let cancelled = false;
    const fallback =
      file.extractedText != null && file.extractedText !== ""
        ? file.extractedText.slice(0, MAX_TEXT_CHARS)
        : null;
    setState({ loading: true, html: null, pdfUrl: null, fallbackText: fallback, error: null });
    (async () => {
      try {
        const res = await fetch(previewUrl(file.id));
        if (res.status === 204) {
          if (!cancelled) {
            setState({
              loading: false,
              html: null,
              pdfUrl: null,
              fallbackText: fallback,
              error: fallback ? null : NO_INLINE_PREVIEW,
            });
          }
          return;
        }
        if (!res.ok) throw new Error(LOAD_FAILED);
        const data = (await res.json()) as { html?: string; pdf?: string };
        if (!cancelled) {
          setState({
            loading: false,
            html: data.html ?? null,
            pdfUrl: data.pdf ?? null,
            fallbackText: fallback,
            error: null,
          });
        }
      } catch (e) {
        if (!cancelled) {
          setState({
            loading: false,
            html: null,
            pdfUrl: null,
            fallbackText: fallback,
            error: e instanceof Error ? e.message : LOAD_FAILED,
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, kind, file.id, file.extractedText]);

  return state;
}

export type FilePreviewProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  file: PreviewFile | null;
  /** Optional list for prev/next navigation. */
  files?: PreviewFile[];
  /** Called when navigating within `files`. */
  onNavigate?: (file: PreviewFile, index: number) => void;
};

export function FilePreview({ open, onOpenChange, file, files, onNavigate }: FilePreviewProps) {
  const index = React.useMemo(() => {
    if (!file || !files) return -1;
    return files.findIndex((f) => f.id === file.id);
  }, [file, files]);
  const hasNav = !!files && files.length > 1 && index >= 0;

  const go = React.useCallback(
    (delta: number) => {
      if (!files || index < 0) return;
      const next = (index + delta + files.length) % files.length;
      onNavigate?.(files[next], next);
    },
    [files, index, onNavigate],
  );

  const t = useT("tickets");
  const tc = useT("common");
  const kind = file ? classify(file) : "none";
  const doc = useDocumentHtml(file ?? { id: "", name: "", mime: "" }, kind, open && !!file);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPortal>
        <DialogOverlay />
        <DialogPrimitive.Popup
          data-slot="dialog-content"
          className={cn(
            "fixed top-1/2 left-1/2 z-50 flex max-h-[90vh] w-full max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl bg-popover text-sm text-popover-foreground ring-1 ring-foreground/10 duration-100 outline-none sm:max-w-4xl data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
          )}
        >
          {/* Header */}
          <div className="flex items-center gap-3 border-b px-4 py-2.5">
            {file ? <MimeIcon mime={file.mime} className="size-4.5 shrink-0 text-sable" /> : null}
            <div className="min-w-0 flex-1">
              <DialogPrimitive.Title className="truncate font-heading text-sm font-medium leading-tight">
                {file?.name ?? t("preview.title")}
              </DialogPrimitive.Title>
              <p className="truncate text-xs text-muted-foreground">
                {file?.mime || t("preview.unknown")}
                {file?.size != null ? ` · ${formatBytes(file.size)}` : ""}
                {hasNav ? ` · ${index + 1} / ${files!.length}` : ""}
              </p>
            </div>
            {hasNav && (
              <div className="flex items-center gap-0.5">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => go(-1)}
                  aria-label={t("preview.previousFile")}
                >
                  <ChevronLeft />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => go(1)}
                  aria-label={t("preview.nextFile")}
                >
                  <ChevronRight />
                </Button>
              </div>
            )}
            {file && (
              <a
                href={downloadUrl(file.id)}
                download
                className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
              >
                <Download />
                <span className="hidden sm:inline">{tc("download")}</span>
              </a>
            )}
            <DialogPrimitive.Close
              render={<Button variant="ghost" size="icon-sm" aria-label={tc("close")} />}
            >
              <X />
            </DialogPrimitive.Close>
          </div>

          {/* Body */}
          <div className="min-h-0 flex-1 overflow-hidden bg-muted/30">
            {!file ? null : kind === "image" ? (
              <div className="flex h-full max-h-[calc(90vh-3.25rem)] items-center justify-center overflow-auto p-4">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={inlineUrl(file.id)}
                  alt={file.name}
                  className="max-h-[calc(90vh-5rem)] max-w-full object-contain"
                />
              </div>
            ) : kind === "pdf" ? (
              <iframe
                src={inlineUrl(file.id)}
                title={file.name}
                className="h-[calc(90vh-3.25rem)] w-full border-0 bg-white"
              />
            ) : kind === "audio" ? (
              <div className="flex h-[calc(90vh-3.25rem)] items-center justify-center p-8">
                <audio src={inlineUrl(file.id)} controls className="w-full max-w-xl">
                  <track kind="captions" />
                </audio>
              </div>
            ) : kind === "video" ? (
              <div className="flex h-[calc(90vh-3.25rem)] items-center justify-center bg-black p-2">
                <video
                  src={inlineUrl(file.id)}
                  controls
                  className="max-h-full max-w-full"
                />
              </div>
            ) : kind === "document" ? (
              <DocumentView state={doc} file={file} />
            ) : kind === "extracted" ? (
              <ExtractedView text={file.extractedText ?? ""} />
            ) : (
              <NoPreview file={file} />
            )}
          </div>
        </DialogPrimitive.Popup>
      </DialogPortal>
    </Dialog>
  );
}

// Renders the sanitized preview HTML from /api/files/[id]/preview in a scrollable
// prose container. Falls back to the extracted-text <pre> when the rich preview is
// unavailable, and to a friendly download prompt when there's nothing to show.
function DocumentView({ state, file }: { state: DocState; file: PreviewFile }) {
  const t = useT("tickets");
  if (state.loading) {
    return (
      <div className="flex h-[calc(90vh-3.25rem)] items-center justify-center text-muted-foreground">
        <Loader2 className="mr-2 size-4 animate-spin" /> {t("preview.loading")}
      </div>
    );
  }
  if (state.pdfUrl) {
    // Faithful office render (Gotenberg → PDF), embedded like a native PDF.
    return (
      <iframe
        src={state.pdfUrl}
        title={t("preview.of", { name: file.name })}
        className="h-[calc(90vh-3.25rem)] w-full bg-background"
      />
    );
  }
  if (state.html) {
    return (
      <div className="h-[calc(90vh-3.25rem)] overflow-auto bg-background p-6">
        <div
          className="prose prose-sm dark:prose-invert max-w-none break-words prose-pre:overflow-x-auto prose-table:block prose-table:overflow-x-auto"
          // Server-sanitized via sanitizeDocumentHtml / renderMarkdown (DOMPurify).
          dangerouslySetInnerHTML={{ __html: state.html }}
        />
      </div>
    );
  }
  if (state.fallbackText) {
    return <ExtractedView text={state.fallbackText} />;
  }
  if (state.error) {
    return (
      <div className="flex h-[calc(90vh-3.25rem)] items-center justify-center text-sm text-destructive">
        {state.error === NO_INLINE_PREVIEW ? t("preview.noInlineFile") : state.error === LOAD_FAILED ? t("preview.loadFailed") : state.error}
      </div>
    );
  }
  return <NoPreview file={file} />;
}

function ExtractedView({ text }: { text: string }) {
  const t = useT("tickets");
  return (
    <div className="flex h-[calc(90vh-3.25rem)] flex-col">
      <p className="border-b bg-background/60 px-4 py-1.5 text-xs text-muted-foreground">
        {t("preview.extracted")}
      </p>
      <div className="min-h-0 flex-1 overflow-auto p-4">
        <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-foreground">
          {text.slice(0, MAX_TEXT_CHARS)}
        </pre>
      </div>
    </div>
  );
}

function NoPreview({ file }: { file: PreviewFile }) {
  const t = useT("tickets");
  return (
    <div className="flex h-[calc(90vh-3.25rem)] flex-col items-center justify-center gap-4 p-8 text-center">
      <MimeIcon mime={file.mime} className="size-12 text-muted-foreground/70" />
      <div className="space-y-1">
        <p className="font-medium">{t("preview.noInlineType")}</p>
        <p className="text-sm text-muted-foreground">{file.mime || t("preview.unknownType")}</p>
      </div>
      <a href={downloadUrl(file.id)} download className={cn(buttonVariants())}>
        <Download />
        {t("preview.downloadFile")}
      </a>
    </div>
  );
}

/**
 * Convenience hook so call sites stay tiny:
 *
 *   const preview = useFilePreview();
 *   ...
 *   <button onClick={() => preview.openFile({ id, name, mime, size })}>open</button>
 *   <FilePreview {...preview.props} />
 *
 * Pass an array to `openFile(file, list)` to enable prev/next navigation.
 */
export function useFilePreview() {
  const [open, setOpen] = React.useState(false);
  const [file, setFile] = React.useState<PreviewFile | null>(null);
  const [files, setFiles] = React.useState<PreviewFile[] | undefined>(undefined);

  const openFile = React.useCallback((f: PreviewFile, list?: PreviewFile[]) => {
    setFile(f);
    setFiles(list);
    setOpen(true);
  }, []);

  const props: FilePreviewProps = {
    open,
    onOpenChange: setOpen,
    file,
    files,
    onNavigate: (f) => setFile(f),
  };

  return { open, openFile, setOpen, props };
}

/** True when the file can be shown inline (image/pdf/text/office-with-text). */
export function canPreview(file: PreviewFile): boolean {
  return classify(file) !== "none";
}
