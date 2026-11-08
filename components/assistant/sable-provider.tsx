"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { usePathname } from "next/navigation";
import type { AssistantScope } from "@/lib/actions/ai-assistant";

/**
 * The global Sable window state machine. Mounted ONCE in the console layout
 * (above the page) so the window — and the active conversation — survive
 * client-side navigation. Three visual states:
 *
 *  - `closed`  → nothing on screen but the floating action button (FAB).
 *  - `min`     → a small floating chat card (the *current* conversation).
 *  - `max`     → a large centered "window" with the conversation-history rail.
 *
 * `min` and `max` render the SAME conversation (shared `conversationId`), so
 * expanding/minimising never loses context, and every chat is persisted and
 * reachable from the history rail in the maximised window.
 */

export type SableState = "closed" | "min" | "max";
export type SableOpenState = "min" | "max";

/** A document shown in the canvas (session-only, no DB) — a draft Sable produced,
 *  or a read-only preview of a pending proposal's body. */
export type SableCanvasDoc = {
  title: string;
  markdown: string;
  /** Optional saved-file name (with extension) hinted by the model. */
  filename?: string;
  /** Optional code/document language hint (e.g. 'bash', 'python'). */
  language?: string;
  /** Pre-rendered HTML body (e.g. a KB-article proposal) — shown as-is (sanitised)
   *  instead of rendering `markdown`. */
  html?: string;
  /** Read-only preview of a proposal: hides the draft write-actions (save/publish),
   *  leaving just Copy / Download / Close. */
  preview?: boolean;
};

const LS_STATE = "sable:lastOpen";
const LS_CONV = "sable:conversationId";
const LS_PROJECT = "sable:projectId";

function readLS(key: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}
function writeLS(key: string, value: string | null) {
  if (typeof window === "undefined") return;
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    /* ignore (private mode / quota) */
  }
}

export type SableContextValue = {
  state: SableState;
  /** The active conversation id (null = a fresh, not-yet-created chat). */
  conversationId: string | null;
  scope: AssistantScope;
  /** The active Sable Project the window is pinned to (null = none). */
  projectId: string | null;
  /** The active project's display name (session-only; header vault chip reads it). */
  projectName: string | null;
  /** In-context surface for the next turn (e.g. the ticket the user opened Sable from). */
  context?: { ticketId?: number; projectId?: string };
  /** Open the window in a given state; optionally point it at a conversation/scope/context. */
  open: (
    state: Exclude<SableState, "closed">,
    opts?: { conversationId?: string | null; scope?: AssistantScope; context?: { ticketId?: number } },
  ) => void;
  /** Re-open in whatever state (min/max) it was last left in. */
  openLast: () => void;
  minimize: () => void;
  maximize: () => void;
  close: () => void;
  /** Start a brand-new (empty) chat in the current scope. */
  newChat: () => void;
  /** Point the window at an existing conversation (from the rail). */
  setConversation: (id: string | null) => void;
  setScope: (scope: AssistantScope) => void;
  /**
   * Pin the window to a Sable Project (id persisted, name session-only), or clear
   * it with null. Pass the name so the header vault chip can label it cheaply.
   */
  setProject: (projectId: string | null, name?: string | null) => void;

  /* ── Artifacts canvas (session-only; no DB in v1) ───────────────────────── */
  /** Whether the editable document canvas is showing (max state only). */
  canvasOpen: boolean;
  /** The draft handed to the canvas (null = nothing to edit). */
  canvasDoc: SableCanvasDoc | null;
  /** Open the canvas with a draft (auto-maximises the window). */
  openCanvas: (doc: SableCanvasDoc) => void;
  /** Close the canvas (the chat/project-home reclaim the pane). */
  closeCanvas: () => void;
  /** Drop text into the chat composer (from the canvas "Insert into chat"). */
  insertIntoComposer: (text: string) => void;
};

const SableCtx = createContext<SableContextValue | null>(null);

export function useSable(): SableContextValue {
  const ctx = useContext(SableCtx);
  if (!ctx) throw new Error("useSable must be used within <SableProvider>");
  return ctx;
}

export function SableProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [state, setState] = useState<SableState>("closed");
  // The last conversation, open state and project are restored from the previous
  // session AFTER mount (see below): reading localStorage while rendering would make
  // the client's first render differ from the server's and break hydration.
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [lastOpen, setLastOpen] = useState<SableOpenState>("min");
  const [scope, setScope] = useState<AssistantScope>("GENERAL");
  const [contextOverride, setContextOverride] = useState<{ ticketId?: number } | undefined>(undefined);
  // The Sable Project the window is pinned to, restored from a previous session.
  const [projectId, setProjectId] = useState<string | null>(null);
  // The active project's name — session-only (only the id is persisted). Resolved
  // lazily by callers (rail lookup) via setProject(id, name).
  const [projectName, setProjectName] = useState<string | null>(null);
  // The Artifacts canvas (session-only — a drafted document the user edits beside
  // the chat). Not persisted: it lives only for the current window session.
  const [canvasDoc, setCanvasDoc] = useState<SableCanvasDoc | null>(null);
  const [canvasOpen, setCanvasOpen] = useState(false);

  useEffect(() => {
    // One-time sync from localStorage after hydration (see the state declarations above).
    /* eslint-disable react-hooks/set-state-in-effect */
    setConversationId(readLS(LS_CONV) || null);
    setLastOpen(readLS(LS_STATE) === "max" ? "max" : "min");
    setProjectId(readLS(LS_PROJECT) || null);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

  // Ticket context derived from the URL, e.g. /tickets/123 (not the list).
  const pathTicketId = useMemo(() => {
    const m = pathname?.match(/\/tickets\/(\d+)(?:$|[/?#])/);
    return m ? Number(m[1]) : undefined;
  }, [pathname]);

  // An explicit context (from a "Sable" link) wins; otherwise use the current page's
  // ticket. The pinned project (if any) rides alongside so a bound chat injects its
  // instructions + files and its retrieval tool resolves.
  const context = useMemo<{ ticketId?: number; projectId?: string } | undefined>(() => {
    const base = contextOverride ?? (pathTicketId ? { ticketId: pathTicketId } : undefined);
    if (projectId) return { ...(base ?? {}), projectId };
    return base;
  }, [contextOverride, pathTicketId, projectId]);

  const open = useCallback<SableContextValue["open"]>((next, opts) => {
    if (opts && "conversationId" in opts) {
      setConversationId(opts.conversationId ?? null);
      writeLS(LS_CONV, opts.conversationId ?? null);
    }
    if (opts?.scope) setScope(opts.scope);
    if (opts && "context" in opts) setContextOverride(opts.context);
    setState(next);
    setLastOpen(next);
    writeLS(LS_STATE, next);
  }, []);

  const openLast = useCallback(() => {
    setState(lastOpen);
  }, [lastOpen]);

  const minimize = useCallback(() => {
    setState("min");
    setLastOpen("min");
    writeLS(LS_STATE, "min");
  }, []);
  const maximize = useCallback(() => {
    setState("max");
    setLastOpen("max");
    writeLS(LS_STATE, "max");
  }, []);
  const close = useCallback(() => setState("closed"), []);

  const newChat = useCallback(() => {
    setConversationId(null);
    setContextOverride(undefined);
    writeLS(LS_CONV, null);
    // A global new chat leaves any active vault — it starts project-less.
    setProjectId(null);
    setProjectName(null);
    writeLS(LS_PROJECT, null);
  }, []);

  const setConversation = useCallback((id: string | null) => {
    setConversationId(id);
    writeLS(LS_CONV, id);
  }, []);

  const setProject = useCallback((id: string | null, name?: string | null) => {
    setProjectId(id);
    setProjectName(id ? name ?? null : null);
    writeLS(LS_PROJECT, id);
  }, []);

  const openCanvas = useCallback((doc: SableCanvasDoc) => {
    setCanvasDoc(doc);
    setCanvasOpen(true);
    // The canvas needs the max layout's right pane — expand if we're minimised.
    setState((s) => (s === "closed" ? s : "max"));
  }, []);

  const closeCanvas = useCallback(() => {
    setCanvasOpen(false);
  }, []);

  // Drop text into the (single) live Sable composer. We write the value through
  // React's native input tracker + dispatch an `input` event so assistant-ui's
  // controlled textarea picks it up — no dependency on unstable composer APIs.
  const insertIntoComposer = useCallback((text: string) => {
    if (typeof document === "undefined") return;
    const el = document.querySelector<HTMLTextAreaElement>(
      'textarea[data-sable-composer]',
    );
    if (!el) return;
    const proto = window.HTMLTextAreaElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
    const existing = el.value;
    const next = existing.trim() ? `${existing.trimEnd()}\n\n${text}` : text;
    if (setter) setter.call(el, next);
    else el.value = next;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.focus();
  }, []);

  const value = useMemo<SableContextValue>(
    () => ({
      state,
      conversationId,
      scope,
      projectId,
      projectName,
      context,
      open,
      openLast,
      minimize,
      maximize,
      close,
      newChat,
      setConversation,
      setScope,
      setProject,
      canvasOpen,
      canvasDoc,
      openCanvas,
      closeCanvas,
      insertIntoComposer,
    }),
    [state, conversationId, scope, projectId, projectName, context, open, openLast, minimize, maximize, close, newChat, setConversation, setProject, canvasOpen, canvasDoc, openCanvas, closeCanvas, insertIntoComposer],
  );

  return <SableCtx.Provider value={value}>{children}</SableCtx.Provider>;
}
