"use client";

import { useCallback, useEffect, useState } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  useDraggable,
  useDroppable,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  Plus,
  Search,
  Folder,
  FolderPlus,
  FolderInput,
  ChevronRight,
  MoreHorizontal,
  Pencil,
  Trash2,
  Archive,
  ArchiveRestore,
  MessageSquare,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
} from "@/components/ui/dropdown-menu";
import {
  listConversations,
  listFolders,
  createFolder,
  renameFolder,
  deleteFolder,
  moveConversation,
  moveConversationToProject,
  renameConversation,
  archiveConversation,
  deleteConversation,
  type ConversationSummary,
  type AiFolderSummary,
  type ProjectSummary,
} from "@/lib/actions/ai-assistant";
import { ProjectRailSection } from "./project-rail-section";
import { NameDialog } from "./name-dialog";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { useServerMessage, useT } from "@/lib/i18n/client";

/**
 * The premium conversation rail: a "New chat" action, search, user folders
 * (create / rename / delete, drag chats in and out) and an archived section.
 * Monochrome and restrained — the classy end of the ITSM palette.
 */
export function SableRail({
  activeId,
  onSelect,
  onNewChat,
  refreshKey,
  activeProjectId = null,
  onOpenProject,
  onNewChatInProject,
  onProjectsChanged,
}: {
  activeId: string | null;
  /**
   * Select a conversation. `projectBinding` carries the chat's project (id+name,
   * resolved from the rail's projects list) so the shell can follow the vault.
   */
  onSelect: (id: string, projectBinding: { id: string | null; name: string | null }) => void;
  onNewChat: () => void;
  /** Bumped by the shell after a turn / new chat so the rail refetches. */
  refreshKey: number;
  isAdmin?: boolean;
  /** The project the window is pinned to (highlighted in the Projects section). */
  activeProjectId?: string | null;
  /** Open a project's home pane (vault) + pin the window to it, labelled by name. */
  onOpenProject?: (id: string, name: string) => void;
  /** Open a project's overview (its composer starts the chat). */
  onNewChatInProject?: (id: string, name: string) => void;
  /** Bumped after a project mutation so the header chip re-fetches. */
  onProjectsChanged?: () => void;
}) {
  const t = useT("assistant");
  const tm = useServerMessage();
  const [convs, setConvs] = useState<ConversationSummary[]>([]);
  const [folders, setFolders] = useState<AiFolderSummary[]>([]);
  // Mirror of the Projects section's loaded list, used to resolve a chat's
  // project name when the vault must follow the selected conversation.
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [showArchived, setShowArchived] = useState(false);
  const [dragging, setDragging] = useState<ConversationSummary | null>(null);
  const [createFolderOpen, setCreateFolderOpen] = useState(false);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const reload = useCallback(async () => {
    const [c, f] = await Promise.all([listConversations(), listFolders()]);
    setConvs(c);
    setFolders(f);
  }, []);

  useEffect(() => {
    let ignore = false;
    Promise.all([listConversations(), listFolders()]).then(([c, f]) => {
      if (ignore) return;
      setConvs(c);
      setFolders(f);
    });
    return () => {
      ignore = true;
    };
  }, [refreshKey]);

  // Selecting a conversation binds the vault to that chat's project: resolve the
  // project name from the loaded Projects list so the header chip + injected
  // context follow the chat.
  const selectConversation = useCallback(
    (id: string) => {
      const conv = convs.find((c) => c.id === id);
      const pid = conv?.projectId ?? null;
      const name = pid ? projects.find((p) => p.id === pid)?.name ?? null : null;
      onSelect(id, { id: pid, name });
    },
    [convs, projects, onSelect],
  );

  const q = query.trim().toLowerCase();
  const match = (c: ConversationSummary) => !q || c.title.toLowerCase().includes(q);
  const active = convs.filter((c) => !c.archived && match(c));
  const archived = convs.filter((c) => c.archived && match(c));
  // Chats pinned to a project live under that project (not here) — and chats in a
  // folder live under the folder. "Chats" is only the truly-loose ones.
  const ungrouped = active.filter((c) => !c.folderId && !c.projectId);
  // Plain const (this repo uses the React compiler — don't useMemo derived lists).
  const byFolder: Record<string, ConversationSummary[]> = {};
  for (const f of folders) byFolder[f.id] = [];
  for (const c of active) if (c.folderId && byFolder[c.folderId]) byFolder[c.folderId].push(c);

  async function onDragStart(e: DragStartEvent) {
    setDragging(convs.find((c) => c.id === e.active.id) ?? null);
  }
  async function onDragEnd(e: DragEndEvent) {
    setDragging(null);
    const overId = e.over?.id ? String(e.over.id) : null;
    const convId = String(e.active.id);
    const conv = convs.find((c) => c.id === convId);
    if (!conv || !overId) return;

    // Dropped onto a project row → pin the conversation to that project (and clear
    // any folder — folders and projects are mutually-exclusive groupings).
    if (overId.startsWith("project:")) {
      const projectId = overId.slice(8);
      if (projectId === (conv.projectId ?? null)) return;
      setConvs((cs) => cs.map((c) => (c.id === convId ? { ...c, projectId, folderId: null } : c)));
      const res = await moveConversationToProject(convId, projectId);
      if (!res.ok) {
        toast.error(res.error ? tm(res.error) : t("rail.couldNotMove"));
        void reload();
      } else {
        onProjectsChanged?.();
      }
      return;
    }

    const target = overId === "ungrouped" ? null : overId.startsWith("folder:") ? overId.slice(7) : undefined;
    if (target === undefined || (target === (conv.folderId ?? null) && !conv.projectId)) return;
    // Optimistic move into a folder / out to loose — also unpins from any project.
    setConvs((cs) => cs.map((c) => (c.id === convId ? { ...c, folderId: target, projectId: null } : c)));
    const res = await moveConversation(convId, target);
    if (!res.ok) {
      toast.error(res.error ? tm(res.error) : t("rail.couldNotMove"));
      void reload();
    } else if (target) {
      setExpanded((s) => ({ ...s, [target]: true }));
    }
  }

  async function onCreateFolder(name: string) {
    const res = await createFolder(name);
    if (!res.ok) {
      toast.error(res.error ? tm(res.error) : t("rail.couldNotCreateFolder"));
      return;
    }
    setFolders((f) => [...f, res.folder]);
    setExpanded((s) => ({ ...s, [res.folder.id]: true }));
  }

  return (
    <DndContext
      id="sable-rail-dnd"
      sensors={sensors}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
    >
      <div className="flex h-full min-h-0 flex-col gap-3 p-3">
        <Button
          type="button"
          onClick={onNewChat}
          className="w-full justify-start gap-2 rounded-lg bg-sable text-sable-foreground shadow-none hover:bg-sable/90"
        >
          <Plus className="size-4" /> {t("newChat")}
        </Button>

        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("rail.searchChats")}
            className="h-8 rounded-lg pl-8 text-sm"
          />
        </div>

        {/* -mx-1/px-1: overflow-y-auto forces overflow-x:auto, which would clip a
            drop-target's ring on the left/right — the padding gives it room, the
            negative margin keeps the rows aligned with the rest of the rail. */}
        <div className="-mx-1 min-h-0 flex-1 space-y-4 overflow-y-auto px-1">
          {/* Projects */}
          <ProjectRailSection
            conversations={convs}
            activeProjectId={activeProjectId}
            activeConversationId={activeId}
            onSelectConversation={selectConversation}
            onOpenProject={(id, name) => onOpenProject?.(id, name)}
            onNewChatInProject={(id, name) => onNewChatInProject?.(id, name)}
            onProjectsChanged={onProjectsChanged}
            onProjectsLoaded={setProjects}
            refreshKey={refreshKey}
          />

          {/* Folders */}
          <section className="space-y-0.5">
            <div className="flex items-center justify-between px-1.5 pb-0.5">
              <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                {t("rail.folders")}
              </span>
              <Button
                type="button"
                size="icon-xs"
                variant="ghost"
                onClick={() => setCreateFolderOpen(true)}
                aria-label={t("rail.newFolder")}
                className="text-muted-foreground hover:text-foreground"
              >
                <FolderPlus className="size-3.5" />
              </Button>
            </div>
            {folders.length === 0 ? (
              <button
                type="button"
                onClick={() => setCreateFolderOpen(true)}
                className="flex w-full flex-col items-center gap-1 rounded-lg border border-dashed border-border/60 px-3 py-3 text-center transition-colors hover:border-sable/40 hover:bg-sable-muted/30"
              >
                <FolderPlus className="size-4 text-muted-foreground/50" />
                <span className="text-[11px] text-muted-foreground">{t("rail.createFolderHint")}</span>
              </button>
            ) : (
              folders.map((f) => (
                <FolderNode
                  key={f.id}
                  folder={f}
                  chats={byFolder[f.id] ?? []}
                  open={expanded[f.id] ?? false}
                  onToggle={() => setExpanded((s) => ({ ...s, [f.id]: !s[f.id] }))}
                  activeId={activeId}
                  onSelect={selectConversation}
                  folders={folders}
                  onChanged={reload}
                />
              ))
            )}
          </section>

          {/* Ungrouped chats */}
          <ChatSection
            id="ungrouped"
            label={t("rail.chats")}
            chats={ungrouped}
            activeId={activeId}
            onSelect={selectConversation}
            folders={folders}
            onChanged={reload}
            emptyHint={active.length === 0 ? t("rail.noConversations") : undefined}
          />

          {/* Archived */}
          {archived.length > 0 ? (
            <section className="space-y-0.5">
              <button
                type="button"
                onClick={() => setShowArchived((v) => !v)}
                className="flex w-full items-center gap-1 px-1.5 py-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground hover:text-foreground"
              >
                <ChevronRight className={cn("size-3 transition-transform", showArchived && "rotate-90")} />
                {t("rail.archivedCount", { count: archived.length })}
              </button>
              {showArchived
                ? archived.map((c) => (
                    <ChatRow
                      key={c.id}
                      conv={c}
                      active={c.id === activeId}
                      onSelect={selectConversation}
                      folders={folders}
                      onChanged={reload}
                    />
                  ))
                : null}
            </section>
          ) : null}
        </div>
      </div>

      <DragOverlay dropAnimation={null}>
        {dragging ? (
          <div className="pointer-events-none flex max-w-56 items-center gap-2 rounded-lg border bg-popover px-2 py-1.5 text-sm shadow-lg">
            <MessageSquare className="size-3.5 shrink-0 text-sable" />
            <span className="truncate">{dragging.title}</span>
          </div>
        ) : null}
      </DragOverlay>

      <NameDialog
        open={createFolderOpen}
        onOpenChange={setCreateFolderOpen}
        title={t("rail.newFolder")}
        label={t("rail.folderName")}
        placeholder={t("rail.folderPlaceholder")}
        submitLabel={t("rail.createFolder")}
        onSubmit={onCreateFolder}
      />
    </DndContext>
  );
}

function ChatSection({
  id,
  label,
  chats,
  activeId,
  onSelect,
  folders,
  onChanged,
  emptyHint,
}: {
  id: string;
  label: string;
  chats: ConversationSummary[];
  activeId: string | null;
  onSelect: (id: string) => void;
  folders: AiFolderSummary[];
  onChanged: () => void;
  emptyHint?: string;
}) {
  const { setNodeRef, isOver } = useDroppable({ id });
  const t = useT("assistant");
  return (
    <section
      ref={setNodeRef}
      className={cn("space-y-0.5 rounded-lg transition-colors", isOver && "bg-sable-muted/60 ring-1 ring-border")}
    >
      <div className="px-1.5 pb-0.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      {chats.length === 0 ? (
        emptyHint ? (
          <div
            className={cn(
              "m-1 flex flex-col items-center gap-1 rounded-lg border border-dashed px-3 py-4 text-center transition-colors",
              isOver ? "border-sable/40 bg-sable-muted/40" : "border-border/60",
            )}
          >
            <MessageSquare className="size-4 text-muted-foreground/50" />
            <span className="text-xs text-muted-foreground">{emptyHint}</span>
            <span className="text-[11px] text-muted-foreground/70">{t("rail.startChatHint")}</span>
          </div>
        ) : null
      ) : (
        chats.map((c) => (
          <ChatRow
            key={c.id}
            conv={c}
            active={c.id === activeId}
            onSelect={onSelect}
            folders={folders}
            onChanged={onChanged}
          />
        ))
      )}
    </section>
  );
}

function FolderNode({
  folder,
  chats,
  open,
  onToggle,
  activeId,
  onSelect,
  folders,
  onChanged,
}: {
  folder: AiFolderSummary;
  chats: ConversationSummary[];
  open: boolean;
  onToggle: () => void;
  activeId: string | null;
  onSelect: (id: string) => void;
  folders: AiFolderSummary[];
  onChanged: () => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `folder:${folder.id}` });
  const t = useT("assistant");
  const tm = useServerMessage();
  const [renaming, setRenaming] = useState(false);

  async function rename(next: string) {
    if (next === folder.name) return;
    const res = await renameFolder(folder.id, next);
    if (res.ok) onChanged();
    else toast.error(res.error ? tm(res.error) : t("rail.couldNotRename"));
  }

  return (
    <div
      ref={setNodeRef}
      className={cn("rounded-lg transition-colors", isOver && "bg-sable-muted/60 ring-1 ring-sable/30")}
    >
      <div
        className={cn(
          "group/folder flex items-center gap-1 rounded-lg px-1.5 py-1 transition-colors hover:bg-muted/60",
        )}
      >
        <button
          type="button"
          onClick={onToggle}
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
        >
          <ChevronRight className={cn("size-3 shrink-0 text-muted-foreground transition-transform", open && "rotate-90")} />
          <Folder className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate text-sm font-medium">{folder.name}</span>
          {chats.length ? (
            <span className="text-[11px] text-muted-foreground">{chats.length}</span>
          ) : null}
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                type="button"
                size="icon-xs"
                variant="ghost"
                aria-label={t("rail.folderOptions")}
                className="shrink-0 opacity-0 transition-opacity group-hover/folder:opacity-100 aria-expanded:opacity-100"
              />
            }
          >
            <MoreHorizontal className="size-3.5" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => setRenaming(true)}>
              <Pencil className="size-3.5" /> {t("rail.rename")}
            </DropdownMenuItem>
            <DropdownMenuItem
              variant="destructive"
              onClick={async () => {
                const res = await deleteFolder(folder.id);
                if (res.ok) onChanged();
                else toast.error(res.error ? tm(res.error) : t("rail.couldNotDelete"));
              }}
            >
              <Trash2 className="size-3.5" /> {t("rail.deleteFolder")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <NameDialog
        open={renaming}
        onOpenChange={setRenaming}
        title={t("rail.renameFolder")}
        label={t("rail.folderName")}
        initialValue={folder.name}
        submitLabel={t("rail.rename")}
        onSubmit={rename}
      />

      {open ? (
        <div className="ml-3 border-l pl-1">
          {chats.length === 0 ? (
            <div
              className={cn(
                "m-1 flex flex-col items-center gap-1 rounded-lg border border-dashed px-3 py-3 text-center transition-colors",
                isOver ? "border-sable/40 bg-sable-muted/40" : "border-border/60",
              )}
            >
              <MessageSquare className="size-3.5 text-muted-foreground/50" />
              <span className="text-[11px] text-muted-foreground">{t("rail.dropChatHere")}</span>
            </div>
          ) : (
            chats.map((c) => (
              <ChatRow
                key={c.id}
                conv={c}
                active={c.id === activeId}
                onSelect={onSelect}
                folders={folders}
                onChanged={onChanged}
              />
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}

function ChatRow({
  conv,
  active,
  onSelect,
  folders,
  onChanged,
}: {
  conv: ConversationSummary;
  active: boolean;
  onSelect: (id: string) => void;
  folders: AiFolderSummary[];
  onChanged: () => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: conv.id });
  const t = useT("assistant");
  const tm = useServerMessage();
  const [renaming, setRenaming] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  async function rename(next: string) {
    if (next === conv.title) return;
    const res = await renameConversation(conv.id, next);
    if (res.ok) onChanged();
    else toast.error(res.error ? tm(res.error) : t("rail.couldNotRename"));
  }

  async function remove() {
    const res = await deleteConversation(conv.id);
    if (res.ok) onChanged();
    else toast.error(res.error ? tm(res.error) : t("rail.couldNotDelete"));
  }

  async function move(folderId: string | null) {
    const res = await moveConversation(conv.id, folderId);
    if (res.ok) onChanged();
    else toast.error(res.error ? tm(res.error) : t("rail.couldNotMove"));
  }

  async function toggleArchive() {
    const res = await archiveConversation(conv.id, !conv.archived);
    if (res.ok) { onChanged(); toast.success(conv.archived ? t("rail.restored") : t("rail.archived")); }
    else toast.error(res.error ? tm(res.error) : t("rail.couldNotUpdate"));
  }

  return (
    <>
    <div
      ref={setNodeRef}
      className={cn(
        "group/row flex items-center gap-1 rounded-lg px-1.5 py-1 transition-colors",
        active ? "bg-muted" : "hover:bg-muted/60",
        isDragging && "opacity-40",
      )}
    >
      <button
        type="button"
        onClick={() => onSelect(conv.id)}
        {...attributes}
        {...listeners}
        className="flex min-w-0 flex-1 items-center gap-2 text-left"
        title={conv.title}
      >
        <MessageSquare className={cn("size-3.5 shrink-0", active ? "text-sable" : "text-muted-foreground")} />
        <span
          className={cn(
            "min-w-0 flex-1 truncate text-sm",
            active ? "font-medium" : "text-foreground/90",
            conv.archived && "text-muted-foreground line-through",
          )}
        >
          {conv.title}
        </span>
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              type="button"
              size="icon-xs"
              variant="ghost"
              aria-label={t("rail.chatOptions")}
              className="shrink-0 opacity-0 transition-opacity group-hover/row:opacity-100 aria-expanded:opacity-100"
            />
          }
        >
          <MoreHorizontal className="size-3.5" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => setRenaming(true)}>
            <Pencil className="size-3.5" /> {t("rail.rename")}
          </DropdownMenuItem>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <FolderInput className="size-3.5" /> {t("rail.moveTo")}
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              {conv.folderId ? (
                <DropdownMenuItem onClick={() => move(null)}>{t("rail.noFolder")}</DropdownMenuItem>
              ) : null}
              {folders
                .filter((f) => f.id !== conv.folderId)
                .map((f) => (
                  <DropdownMenuItem key={f.id} onClick={() => move(f.id)}>
                    <Folder className="size-3.5" /> {f.name}
                  </DropdownMenuItem>
                ))}
              {folders.length === 0 ? (
                <DropdownMenuItem disabled>{t("rail.noFoldersYet")}</DropdownMenuItem>
              ) : null}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={toggleArchive}>
            {conv.archived ? (
              <><ArchiveRestore className="size-3.5" /> {t("rail.restore")}</>
            ) : (
              <><Archive className="size-3.5" /> {t("rail.archive")}</>
            )}
          </DropdownMenuItem>
          <DropdownMenuItem variant="destructive" onClick={() => setConfirmDelete(true)}>
            <Trash2 className="size-3.5" /> {t("rail.delete")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
    <ConfirmDialog
      open={confirmDelete}
      onOpenChange={setConfirmDelete}
      onConfirm={remove}
      title={t("rail.deleteChatTitle")}
      description={t("rail.deleteChatDescription")}
      confirmLabel={t("rail.deleteChat")}
    />
    <NameDialog
      open={renaming}
      onOpenChange={setRenaming}
      title={t("rail.renameChat")}
      label={t("rail.chatName")}
      initialValue={conv.title}
      submitLabel={t("rail.rename")}
      onSubmit={rename}
    />
    </>
  );
}
