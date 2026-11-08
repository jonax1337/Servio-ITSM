"use client";

import { useCallback, useState } from "react";
import { Plus, X, Minus, Maximize2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { AI_ASSISTANT_NAME } from "@/lib/constants";
import { useSable } from "./sable-provider";
import { SableThread } from "./sable-thread";
import { SableRail } from "./sable-rail";
import { SableHeader, SABLE_MIN_SIZE } from "./sable-chrome";
import { ProjectHome } from "./project-home";
import { SableCanvas } from "./sable-canvas";
import { useT } from "@/lib/i18n/client";

/**
 * The global Sable window. A SINGLE persistent chat is kept mounted across the
 * min ↔ max transition (so an in-flight stream is never lost); only the framing
 * changes. The maximised state adds the conversation-history rail.
 *
 * `variant="inline"` renders the two-pane surface full-size with no overlay
 * (used by the /assistant route so the sidebar item stays deep-linkable),
 * sharing the same provider state as the overlay.
 */
export function SableWindow({
  isAdmin = false,
  disabled = false,
  teaser = false,
  variant = "overlay",
}: {
  isAdmin?: boolean;
  disabled?: boolean;
  teaser?: boolean;
  variant?: "overlay" | "inline";
}) {
  const sable = useSable();
  const t = useT("assistant");
  const inline = variant === "inline";
  const state = inline ? "max" : sable.state;

  // A selection nonce keys <SableThread>: it changes ONLY on explicit selection or
  // new-chat, never when a fresh chat auto-creates its id — so the live stream
  // survives min↔max and id assignment without a remount.
  const [selected, setSelected] = useState<{ id: string | null; nonce: number }>({
    id: sable.conversationId,
    nonce: 0,
  });
  // Bumped to make the rail refetch (after a turn / new chat / creation).
  const [refreshKey, setRefreshKey] = useState(0);
  // Drives the exit animation: on close we keep the panel mounted for a beat so
  // it can animate out, then actually close. Event-handler driven (no effect).
  const [closing, setClosing] = useState(false);

  const handleClose = useCallback(() => {
    setClosing(true);
    window.setTimeout(() => {
      setClosing(false);
      sable.close();
    }, 160);
  }, [sable]);

  // Bridge external conversation changes (e.g. a "Sable" link that opens a saved
  // chat) into a remount — but NOT when a fresh chat self-assigns its id (that
  // must keep the in-flight stream). Done during render (React's recommended
  // "adjust state when a prop changes" pattern) rather than in an effect.
  const [lastExternalId, setLastExternalId] = useState<string | null>(sable.conversationId);
  if (sable.conversationId !== lastExternalId) {
    setLastExternalId(sable.conversationId);
    setSelected((s) =>
      sable.conversationId === s.id ? s : { id: sable.conversationId, nonce: s.nonce + 1 },
    );
  }

  const refresh = useCallback(() => setRefreshKey((k) => k + 1), []);

  const visible = inline || state !== "closed";

  const selectConversation = useCallback(
    (id: string | null) => {
      setSelected((s) => ({ id, nonce: s.nonce + 1 }));
      sable.setConversation(id);
    },
    [sable],
  );

  const onNewChat = useCallback(() => {
    setSelected((s) => ({ id: null, nonce: s.nonce + 1 }));
    sable.newChat();
  }, [sable]);

  const onConversationCreated = useCallback(
    (id: string) => {
      // Adopt the new id WITHOUT bumping the nonce (no remount), then refresh the rail.
      setSelected((s) => ({ id, nonce: s.nonce }));
      sable.setConversation(id);
      void refresh();
    },
    [sable, refresh],
  );

  // Open a project as the active workspace: bind it and start a fresh, empty
  // project-bound chat — whose empty state IS the project overview (files + links).
  const openProjectOverview = useCallback(
    (id: string, name: string) => {
      sable.setProject(id, name);
      sable.setConversation(null);
      setSelected((s) => ({ id: null, nonce: s.nonce + 1 }));
      if (!inline && sable.state !== "max") sable.maximize();
    },
    [sable, inline],
  );

  // Selecting a conversation reveals that chat and makes the active project follow
  // it (id + name resolved by the rail) so the composer's project chip matches.
  const selectConversationFromRail = useCallback(
    (id: string, binding: { id: string | null; name: string | null }) => {
      sable.setProject(binding.id, binding.name);
      selectConversation(id);
    },
    [sable, selectConversation],
  );

  // The global "New chat" leaves any project (provider's newChat clears it).
  const onNewChatGlobal = onNewChat;

  if (!visible) return null;

  const scope = sable.scope;

  const chat = disabled ? null : (
    <SableThread
      key={selected.nonce}
      conversationId={selected.id}
      scope={scope}
      context={sable.context}
      overview={
        sable.projectId ? (
          <ProjectHome
            projectId={sable.projectId}
            onChanged={refresh}
            onDeleted={() => {
              sable.setProject(null);
              onNewChat();
              void refresh();
            }}
          />
        ) : undefined
      }
      projectName={sable.projectName}
      onOpenOverview={
        sable.projectId
          ? () => openProjectOverview(sable.projectId as string, sable.projectName ?? t("projectFallback"))
          : undefined
      }
      onConversationCreated={onConversationCreated}
      onActivity={refresh}
    />
  );

  const header = (
    <SableHeader
      beta
      subtitle={sable.context?.ticketId ? t("helpingWithTicket", { id: sable.context.ticketId }) : undefined}
    >
      <Button type="button" variant="ghost" size="icon-sm" onClick={onNewChatGlobal} aria-label={t("newChat")}>
        <Plus className="size-4" />
      </Button>
      {!inline && state === "min" ? (
        <Button type="button" variant="ghost" size="icon-sm" onClick={sable.maximize} aria-label={t("expand")}>
          <Maximize2 className="size-4" />
        </Button>
      ) : null}
      {!inline && state === "max" ? (
        <Button type="button" variant="ghost" size="icon-sm" onClick={sable.minimize} aria-label={t("minimize")}>
          <Minus className="size-4" />
        </Button>
      ) : null}
      {!inline ? (
        <Button type="button" variant="ghost" size="icon-sm" onClick={handleClose} aria-label={t("close")}>
          <X className="size-4" />
        </Button>
      ) : null}
    </SableHeader>
  );

  const rail =
    state === "max" ? (
      <aside className="hidden w-72 shrink-0 flex-col border-r bg-muted/20 md:flex">
        <SableRail
          activeId={selected.id}
          onSelect={selectConversationFromRail}
          onNewChat={onNewChatGlobal}
          refreshKey={refreshKey}
          isAdmin={isAdmin}
          activeProjectId={sable.projectId}
          onOpenProject={openProjectOverview}
          onNewChatInProject={openProjectOverview}
          onProjectsChanged={refresh}
        />
      </aside>
    ) : null;

  // The Artifacts canvas is a SECOND, optional right-side pane (max only). It
  // coexists with the chat (kept mounted) — the chat pane narrows to make room.
  const showCanvas = state === "max" && sable.canvasOpen && sable.canvasDoc !== null;

  const panelBody = (
    <div className="flex min-h-0 flex-1 overflow-hidden">
      {rail}
      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
        {disabled ? (
          <div className="border-b bg-amber-500/10 px-3 py-2 text-center text-xs text-amber-700 dark:text-amber-300">
            {teaser
              ? t("previewNotice", { name: AI_ASSISTANT_NAME })
              : t("notEnabledNotice", { name: AI_ASSISTANT_NAME })}
          </div>
        ) : null}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">{chat}</div>
      </div>
      {showCanvas ? <SableCanvas /> : null}
    </div>
  );

  if (inline) {
    return (
      <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border bg-background shadow-sm">
        {header}
        {panelBody}
      </div>
    );
  }

  const maxed = state === "max";

  return (
    // Min: a small floating card bottom-right. Max: a large floating panel that fills
    // the content area (small margins), leaving the app sidebar (width `--sidebar-width`)
    // free on the left — full width on mobile where the sidebar is an off-canvas overlay.
    // The frosted backdrop dims the page behind (incl. the sidebar); click it to minimise.
    <div className={cn("pointer-events-none fixed z-50", maxed ? "inset-0" : "inset-0 flex items-end justify-end p-4")}>
      {maxed && !closing ? (
        <div
          aria-hidden
          onClick={sable.minimize}
          className="pointer-events-auto absolute inset-0 bg-black/40 backdrop-blur-sm duration-200 animate-in fade-in-0"
        />
      ) : null}
      <div
        role="dialog"
        aria-label={AI_ASSISTANT_NAME}
        className={cn(
          "pointer-events-auto flex flex-col overflow-hidden rounded-xl border bg-background shadow-2xl",
          maxed
            ? "fixed inset-3 md:left-[calc(var(--sidebar-width)+0.75rem)]"
            : cn("relative", SABLE_MIN_SIZE),
          closing
            ? "duration-150 animate-out fade-out-0 zoom-out-95"
            : "duration-200 animate-in fade-in-0 zoom-in-95",
        )}
      >
        {header}
        {panelBody}
      </div>
    </div>
  );
}
