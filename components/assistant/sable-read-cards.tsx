"use client";

import Link from "next/link";
import {
  AlertTriangle,
  BookOpen,
  Clock,
  FilePen,
  FileText,
  FolderSearch,
  Globe,
  PanelRightOpen,
  Ticket as TicketIcon,
} from "lucide-react";
import { useEffect } from "react";
import type { FC, ReactNode } from "react";

import { cn } from "@/lib/utils";
import { ToneBadge } from "@/components/status-badge";
import { inlineBadgeMeta } from "@/lib/inline-badge";
import { Button } from "@/components/ui/button";
import { useSable, type SableCanvasDoc } from "./sable-provider";

/**
 * Branded, generative read cards for a couple of high-value Sable tools — a
 * compact ticket summary for `get_ticket` and a file-hit list for
 * `project.search_files` (tool `project_search_files`). They render off the
 * tool RESULT and are routed from `SableToolUI` alongside the activity chips and
 * the default fallback, so they only ever augment the streaming path (never
 * replace it) and quietly no-op to the plain chip when a result isn't present
 * (e.g. the buffered claude-code path, which never surfaces tool outputs).
 */

/* ── get_ticket ─────────────────────────────────────────────────────────── */

type TicketResult = {
  ok?: boolean;
  ticket?: {
    ref?: string;
    title?: string;
    status?: string;
    priority?: string;
    assignee?: string | null;
    team?: string | null;
    resolveDueAt?: string | null;
    breached?: boolean;
  };
};

/** The numeric ticket id encoded in a ref like `INC-0042` → 42, else null. */
function ticketIdFromRef(ref: string): number | null {
  const m = ref.match(/-0*(\d+)\s*$/);
  return m ? Number(m[1]) : null;
}

/** A compact, on-brand summary of one ticket (ref, status/priority, SLA). */
export const SableTicketCard: FC<{ result: unknown }> = ({ result }) => {
  const t = (result as TicketResult | undefined)?.ticket;
  if (!t?.ref) return null;

  // The console ticket route is keyed by numeric id (not the ref); link only
  // when we can recover it from the ref, otherwise render a static card.
  const id = ticketIdFromRef(t.ref);
  const cardClass =
    "group my-1 block rounded-xl border bg-card p-3 text-sm shadow-sm transition-colors";
  const body = <TicketCardBody t={t} />;

  if (id == null) {
    return <div className={cardClass}>{body}</div>;
  }
  return (
    <Link
      href={`/tickets/${id}`}
      className={cn(cardClass, "hover:border-sable/40 hover:bg-sable-muted/30")}
    >
      {body}
    </Link>
  );
};

const TicketCardBody: FC<{ t: NonNullable<TicketResult["ticket"]> }> = ({
  t,
}) => {
  return (
    <>
      <div className="flex items-center gap-2">
        <span className="grid size-6 shrink-0 place-items-center rounded-md bg-sable-muted text-sable">
          <TicketIcon className="size-3.5" />
        </span>
        <span className="font-mono text-xs font-medium text-sable">{t.ref}</span>
        {t.breached ? (
          <span className="inline-flex items-center gap-1 rounded-md bg-destructive/10 px-1.5 py-0.5 text-[10px] font-medium text-destructive">
            <AlertTriangle className="size-3" /> SLA breached
          </span>
        ) : null}
      </div>

      {t.title ? (
        <p className="mt-1.5 line-clamp-2 font-medium text-foreground">{t.title}</p>
      ) : null}

      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px]">
        {t.status ? <StateBadge namespace="status" value={t.status} /> : null}
        {t.priority ? <StateBadge namespace="priority" value={t.priority} /> : null}
        {t.assignee ? <Pill muted>{t.assignee}</Pill> : null}
        {t.team ? <Pill muted>{t.team}</Pill> : null}
      </div>

      {t.resolveDueAt ? (
        <p className="mt-2 flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <Clock className="size-3" /> Resolve due {t.resolveDueAt}
        </p>
      ) : null}
    </>
  );
};

/** A ticket field as the app's own colored badge, or a plain pill for a value it does not know. */
const StateBadge: FC<{ namespace: string; value: string }> = ({ namespace, value }) => {
  const meta = inlineBadgeMeta(`${namespace}:${value}`);
  return meta ? <ToneBadge meta={meta} dot /> : <Pill>{value}</Pill>;
};

const Pill: FC<{ children: ReactNode; muted?: boolean }> = ({
  children,
  muted,
}) => (
  <span
    className={cn(
      "rounded-md px-1.5 py-0.5 font-medium",
      muted
        ? "bg-muted text-muted-foreground"
        : "bg-sable-muted text-sable uppercase tracking-wide",
    )}
  >
    {children}
  </span>
);

/* ── draft_document ─────────────────────────────────────────────────────── */

type DraftResult = { ok?: boolean; title?: string; markdown?: string; filename?: string; language?: string };

/** True once per distinct draft signature, so a fresh draft auto-opens the
 * canvas exactly once — but re-hydrating the thread (reload, revisit) does not
 * re-pop it. Survives client re-renders; a full reload resets it, at which point
 * the localStorage guard below takes over. */
const AUTO_OPENED = new Set<string>();

function draftSignature(d: SableCanvasDoc): string {
  return `${d.title}␟${d.filename ?? ""}␟${d.markdown.length}␟${d.markdown.slice(0, 48)}`;
}
function seenPersisted(sig: string): boolean {
  try {
    return window.localStorage.getItem(`sable:draft-opened:${sig}`) === "1";
  } catch {
    return false;
  }
}
function markPersisted(sig: string) {
  try {
    window.localStorage.setItem(`sable:draft-opened:${sig}`, "1");
  } catch {
    /* ignore */
  }
}

/**
 * A compact card for `draft_document`: Sable handed a long draft to the editable
 * canvas. Renders the title + an "Open in canvas" button that pops the document
 * into the side panel (via the provider), and AUTO-OPENS the canvas the first
 * time a fresh draft lands (matching the prompt's promise that drafting "opens
 * an editable canvas beside the chat"). Reads from the tool `result`, falling
 * back to the `args` — `draft_document`'s execute is a pure pass-through, so the
 * args always carry the full document even on providers that don't surface tool
 * results to the client (Ollama streaming, buffered claude-code).
 */
export const SableDraftCard: FC<{ result: unknown; args?: Record<string, unknown> }> = ({
  result,
  args,
}) => {
  const { openCanvas } = useSable();
  const r = (result ?? undefined) as DraftResult | undefined;
  const a = (args ?? undefined) as DraftResult | undefined;
  const pick = (k: keyof DraftResult): string | undefined => {
    const v = r?.[k] ?? a?.[k];
    return typeof v === "string" ? v : undefined;
  };
  const title = (pick("title") ?? "").trim();
  const markdown = pick("markdown") ?? "";

  const doc: SableCanvasDoc | null =
    title && markdown
      ? {
          title,
          markdown,
          filename: pick("filename"),
          language: pick("language"),
        }
      : null;

  // Auto-open the canvas once per fresh draft (never on re-hydrate).
  useEffect(() => {
    if (!doc) return;
    const sig = draftSignature(doc);
    if (AUTO_OPENED.has(sig) || seenPersisted(sig)) return;
    AUTO_OPENED.add(sig);
    markPersisted(sig);
    openCanvas(doc);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc?.title, doc?.markdown]);

  if (!doc) return null;
  return (
    <div className="my-1 flex items-center gap-3 rounded-xl border bg-card p-3 text-sm shadow-sm">
      <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-sable-muted text-sable">
        <FilePen className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          Drafted
        </p>
        <p className="truncate font-medium text-foreground">{title}</p>
      </div>
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="shrink-0 gap-1.5 border-sable/40 text-sable hover:bg-sable-muted/40"
        onClick={() => openCanvas(doc)}
      >
        <PanelRightOpen className="size-3.5" />
        Open in canvas
      </Button>
    </div>
  );
};

/* ── project_search_files ───────────────────────────────────────────────── */

type FileHit = { fileId?: string; file?: string; snippet?: string };
type FileSearchResult = { hits?: FileHit[] };

/** A short list of project-file matches, each with a snippet + a source chip. */
export const SableFileHitsCard: FC<{ result: unknown }> = ({ result }) => {
  const hits = (result as FileSearchResult | undefined)?.hits;
  if (!Array.isArray(hits) || hits.length === 0) return null;

  return (
    <div className="my-1 rounded-xl border bg-card p-3 text-sm shadow-sm">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <FolderSearch className="size-3.5 text-sable" />
        <span className="font-medium text-foreground">
          {hits.length} passage{hits.length === 1 ? "" : "s"} from the project files
        </span>
      </div>

      <ul className="mt-2 grid gap-2">
        {hits.slice(0, 5).map((h, i) => (
          <li
            key={`${h.fileId ?? h.file ?? "hit"}-${i}`}
            className="rounded-lg bg-muted/40 p-2"
          >
            {h.snippet ? (
              <p className="line-clamp-3 text-[13px] leading-relaxed text-foreground/90">
                {h.snippet}
              </p>
            ) : null}
            <div className="mt-1.5">
              <SourceChip fileId={h.fileId} name={h.file} />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
};

/**
 * A single source-citation chip: links a project-file hit to its raw file at
 * `/api/files/[id]` when we have the id, otherwise renders the file name as a
 * plain label.
 */
const SourceChip: FC<{ fileId?: string; name?: string }> = ({
  fileId,
  name,
}) => {
  const label = name || "file";
  const chip = (
    <span
      className={cn(
        "inline-flex max-w-full items-center gap-1 rounded-md border border-border/60 bg-background px-1.5 py-0.5 text-[11px] font-medium",
        fileId
          ? "text-sable hover:border-sable/40 hover:bg-sable-muted/40"
          : "text-muted-foreground",
      )}
    >
      <FileText className="size-3 shrink-0" />
      <span className="truncate">{label}</span>
    </span>
  );
  if (!fileId) return chip;
  return (
    <a
      href={`/api/files/${encodeURIComponent(fileId)}`}
      target="_blank"
      rel="noreferrer noopener"
      className="inline-flex max-w-full"
    >
      {chip}
    </a>
  );
};

/* ── cited_sources (web + KB + files, aggregated at the end) ────────────── */

type SourceItem = { label: string; url: string; kind: "web" | "kb" | "file" };

/**
 * A "Sources" row rendered UNDER the answer: every web page, KB article and
 * project file Sable grounded on this turn (aggregated server-side and emitted
 * as a synthetic `cited_sources` tool part). Web links open in a new tab;
 * KB/file links stay in-app.
 */
/** Defence-in-depth: never render a link with an unsafe scheme. Web links must be
 *  http(s); in-app (kb/file) links must be a plain relative path (not "//…"). */
function isSafeSourceUrl(s: SourceItem): boolean {
  if (s.kind === "web") return /^https?:\/\//i.test(s.url);
  return s.url.startsWith("/") && !s.url.startsWith("//");
}

export const SableSourcesCard: FC<{ result: unknown }> = ({ result }) => {
  const all = (result as { sources?: SourceItem[] } | undefined)?.sources;
  const sources = Array.isArray(all) ? all.filter(isSafeSourceUrl) : [];
  if (sources.length === 0) return null;
  return (
    <div className="my-1.5 flex flex-wrap items-center gap-1.5">
      <span className="text-[11px] font-medium text-muted-foreground">Sources</span>
      {sources.map((s, i) => {
        const Icon = s.kind === "kb" ? BookOpen : s.kind === "file" ? FileText : Globe;
        const cls =
          "inline-flex max-w-[240px] items-center gap-1 rounded-md border border-border/60 bg-background px-1.5 py-0.5 text-[11px] font-medium text-foreground/80 transition-colors hover:border-sable/40 hover:bg-sable-muted/30 hover:text-sable";
        return s.kind === "web" ? (
          <a key={`${s.url}-${i}`} href={s.url} target="_blank" rel="noreferrer noopener" className={cls}>
            <Icon className="size-3 shrink-0 text-muted-foreground" />
            <span className="truncate">{s.label}</span>
          </a>
        ) : (
          <Link key={`${s.url}-${i}`} href={s.url} className={cls}>
            <Icon className="size-3 shrink-0 text-muted-foreground" />
            <span className="truncate">{s.label}</span>
          </Link>
        );
      })}
    </div>
  );
};

/* ── citation row (KB + tickets) ────────────────────────────────────────── */

export type Citation = { label: string; href: string; external?: boolean };

/**
 * A compact inline row of source-citation chips rendered under an answer. Used
 * for `search_knowledge_base` (KB articles → `/knowledge/[slug]`) hits so the
 * user can jump to the source Sable grounded on.
 */
export const SableCitationRow: FC<{ citations: Citation[] }> = ({
  citations,
}) => {
  if (citations.length === 0) return null;
  return (
    <div className="my-1 flex flex-wrap items-center gap-1.5">
      <span className="text-[11px] font-medium text-muted-foreground">Sources</span>
      {citations.map((c, i) =>
        c.external ? (
          <a
            key={`${c.href}-${i}`}
            href={c.href}
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex max-w-full items-center gap-1 rounded-md border border-border/60 bg-background px-1.5 py-0.5 text-[11px] font-medium text-sable hover:border-sable/40 hover:bg-sable-muted/40"
          >
            <FileText className="size-3 shrink-0" />
            <span className="truncate">{c.label}</span>
          </a>
        ) : (
          <Link
            key={`${c.href}-${i}`}
            href={c.href}
            className="inline-flex max-w-full items-center gap-1 rounded-md border border-border/60 bg-background px-1.5 py-0.5 text-[11px] font-medium text-sable hover:border-sable/40 hover:bg-sable-muted/40"
          >
            <FileText className="size-3 shrink-0" />
            <span className="truncate">{c.label}</span>
          </Link>
        ),
      )}
    </div>
  );
};
