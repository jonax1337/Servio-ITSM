"use client";

import { useCallback, useEffect, useState } from "react";
import { useDroppable, useDraggable } from "@dnd-kit/core";
import {
  Archive,
  ArchiveRestore,
  Boxes,
  ChevronDown,
  ChevronRight,
  Loader2,
  MessageSquare,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { NameDialog } from "./name-dialog";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { useServerMessage, useT } from "@/lib/i18n/client";
import {
  listProjects,
  createProject,
  archiveProject,
  renameConversation,
  deleteConversation,
  type ProjectSummary,
  type ConversationSummary,
} from "@/lib/actions/ai-assistant";

/**
 * The rail "Projects" section (above Folders) — the Vault entry point. Each
 * project row opens as the active vault (home pane) and expands to show its
 * pinned conversations plus a "New chat in project" action. A "+" creates a
 * project and opens its home. Rows are `project:<id>` droppables so dragging a
 * chat onto one pins it (handled by the parent DndContext's onDragEnd).
 *
 * Rendered INSIDE the rail's <DndContext>, so its droppables share the same
 * drag session as the folders.
 */
export function ProjectRailSection({
  conversations,
  activeProjectId,
  activeConversationId,
  onSelectConversation,
  onOpenProject,
  onNewChatInProject,
  onProjectsChanged,
  onProjectsLoaded,
  refreshKey,
}: {
  /** All the actor's conversations (from the rail) — filtered to pinned per project. */
  conversations: ConversationSummary[];
  activeProjectId: string | null;
  activeConversationId: string | null;
  onSelectConversation: (id: string) => void;
  /** Open the project home (vault) + pin the window to it, labelled by name. */
  onOpenProject: (id: string, name: string) => void;
  /** Start (and select) a new chat inside a project — binds the vault by name. */
  onNewChatInProject: (id: string, name: string) => void;
  /** Bumped after create/rename/delete so the header chip etc. re-fetch. */
  onProjectsChanged?: () => void;
  /** Report the loaded (active) projects up so the rail can resolve names. */
  onProjectsLoaded?: (projects: ProjectSummary[]) => void;
  refreshKey: number;
}) {
  const t = useT("assistant");
  const tm = useServerMessage();
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [createOpen, setCreateOpen] = useState(false);
  const [showArchived, setShowArchived] = useState(false);

  const apply = useCallback(
    (rows: ProjectSummary[]) => {
      setProjects(rows);
      onProjectsLoaded?.(rows);
    },
    [onProjectsLoaded],
  );

  async function archive(id: string, archived: boolean) {
    setProjects((ps) => ps.map((p) => (p.id === id ? { ...p, archived } : p)));
    const res = await archiveProject(id, archived);
    if (!res.ok) {
      toast.error(res.error ? tm(res.error) : t("rail.couldNotUpdate"));
      apply(await listProjects());
    } else {
      onProjectsChanged?.();
    }
  }


  useEffect(() => {
    let ignore = false;
    listProjects()
      .then((rows) => {
        if (!ignore) apply(rows);
      })
      .finally(() => {
        if (!ignore) setLoading(false);
      });
    return () => {
      ignore = true;
    };
  }, [refreshKey, apply]);

  async function onCreate(name: string) {
    const res = await createProject(name);
    if (!res.ok) {
      toast.error(res.error ? tm(res.error) : t("rail.couldNotCreateProject"));
      return;
    }
    setProjects((p) => [res.project, ...p]);
    onProjectsChanged?.();
    onOpenProject(res.project.id, res.project.name);
  }

  const byProject: Record<string, ConversationSummary[]> = {};
  for (const p of projects) byProject[p.id] = [];
  for (const c of conversations) {
    if (!c.archived && c.projectId && byProject[c.projectId]) byProject[c.projectId].push(c);
  }

  const activeProjects = projects.filter((p) => !p.archived);
  const archivedProjects = projects.filter((p) => p.archived);

  const projectRow = (project: ProjectSummary) => (
    <ProjectRow
      key={project.id}
      project={project}
      chats={byProject[project.id] ?? []}
      open={expanded[project.id] ?? false}
      onToggle={() => setExpanded((s) => ({ ...s, [project.id]: !s[project.id] }))}
      isActive={project.id === activeProjectId}
      activeConversationId={activeConversationId}
      onSelectConversation={onSelectConversation}
      onOpenProject={onOpenProject}
      onNewChatInProject={onNewChatInProject}
      onChanged={() => onProjectsChanged?.()}
      onArchive={(a) => void archive(project.id, a)}
    />
  );

  return (
    <section className="space-y-0.5">
      <div className="flex items-center justify-between px-1.5 pb-0.5">
        <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          {t("projects.title")}
        </span>
        <Button
          type="button"
          size="icon-xs"
          variant="ghost"
          onClick={() => setCreateOpen(true)}
          aria-label={t("projects.new")}
          className="text-muted-foreground hover:text-foreground"
        >
          <Plus className="size-3.5" />
        </Button>
      </div>

      <NameDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        title={t("projects.new")}
        label={t("projects.name")}
        placeholder={t("projects.namePlaceholder")}
        submitLabel={t("projects.create")}
        onSubmit={onCreate}
      />

      {loading ? (
        <div className="px-1.5 py-1">
          <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
        </div>
      ) : activeProjects.length === 0 && archivedProjects.length === 0 ? (
        <button
          type="button"
          onClick={() => setCreateOpen(true)}
          className="flex w-full flex-col items-center gap-1 rounded-lg border border-dashed border-sable/25 bg-sable-muted/20 px-3 py-4 text-center transition-colors hover:bg-sable-muted/40"
        >
          <Boxes className="size-4 text-sable/70" />
          <span className="text-xs font-medium">{t("projects.createOne")}</span>
          <span className="text-[11px] text-muted-foreground">
            {t("projects.createHint")}
          </span>
        </button>
      ) : (
        <>
          {activeProjects.map(projectRow)}
          {archivedProjects.length > 0 ? (
            <div className="pt-0.5">
              <button
                type="button"
                onClick={() => setShowArchived((v) => !v)}
                className="flex w-full items-center gap-1 rounded-lg px-1.5 py-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground transition-colors hover:text-foreground"
              >
                <ChevronDown className={cn("size-3 transition-transform", !showArchived && "-rotate-90")} />
                {t("projects.archived")}
                <span className="tracking-normal">{archivedProjects.length}</span>
              </button>
              {showArchived ? archivedProjects.map(projectRow) : null}
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}

function ProjectRow({
  project,
  chats,
  open,
  onToggle,
  isActive,
  activeConversationId,
  onSelectConversation,
  onOpenProject,
  onNewChatInProject,
  onChanged,
  onArchive,
}: {
  project: ProjectSummary;
  chats: ConversationSummary[];
  open: boolean;
  onToggle: () => void;
  isActive: boolean;
  activeConversationId: string | null;
  onSelectConversation: (id: string) => void;
  onOpenProject: (id: string, name: string) => void;
  onNewChatInProject: (id: string, name: string) => void;
  onChanged: () => void;
  onArchive: (archived: boolean) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `project:${project.id}` });
  const t = useT("assistant");

  // The "+" opens the project overview (its own composer starts the chat) rather
  // than eagerly creating an empty "New chat" row.
  function newChatInProject() {
    onNewChatInProject(project.id, project.name);
  }

  return (
    <div
      ref={setNodeRef}
      className={cn("rounded-lg transition-colors", isOver && "bg-sable-muted/60 ring-1 ring-sable/30")}
    >
      <div
        className={cn(
          "group/project flex items-center gap-1 rounded-lg px-1.5 py-1 transition-colors",
          isActive ? "bg-muted" : "hover:bg-muted/60",
        )}
      >
        <button type="button" onClick={onToggle} className="flex shrink-0 items-center" aria-label={open ? t("collapse") : t("expand")}>
          <ChevronRight className={cn("size-3 text-muted-foreground transition-transform", open && "rotate-90")} />
        </button>
        <button
          type="button"
          onClick={() => onOpenProject(project.id, project.name)}
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
          title={t("projects.open", { name: project.name })}
        >
          <Boxes className={cn("size-3.5 shrink-0", isActive ? "text-sable" : "text-muted-foreground")} />
          <span className={cn("min-w-0 flex-1 truncate text-sm", isActive ? "font-medium" : "text-foreground/90")}>
            {project.name}
          </span>
          {project.isShared ? (
            <Users className="size-3 shrink-0 text-muted-foreground" aria-label={t("projects.shared")} />
          ) : null}
        </button>
        <Button
          type="button"
          size="icon-xs"
          variant="ghost"
          onClick={newChatInProject}
          aria-label={t("projects.newChatIn")}
          className="shrink-0 opacity-0 transition-opacity group-hover/project:opacity-100"
        >
          <Plus className="size-3.5" />
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                type="button"
                size="icon-xs"
                variant="ghost"
                aria-label={t("projects.options")}
                className="shrink-0 opacity-0 transition-opacity group-hover/project:opacity-100 aria-expanded:opacity-100"
              />
            }
          >
            <MoreHorizontal className="size-3.5" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => onArchive(!project.archived)}>
              {project.archived ? (
                <><ArchiveRestore className="size-3.5" /> {t("projects.unarchive")}</>
              ) : (
                <><Archive className="size-3.5" /> {t("rail.archive")}</>
              )}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

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
              <span className="text-[11px] text-muted-foreground">{t("projects.dropToPin")}</span>
            </div>
          ) : (
            chats.map((c) => (
              <ProjectChatRow
                key={c.id}
                conv={c}
                active={c.id === activeConversationId}
                onSelect={onSelectConversation}
                onChanged={onChanged}
              />
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}

function ProjectChatRow({
  conv,
  active,
  onSelect,
  onChanged,
}: {
  conv: ConversationSummary;
  active: boolean;
  onSelect: (id: string) => void;
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

  return (
    <>
      <div
        ref={setNodeRef}
        className={cn(
          "group/prow flex items-center gap-1 rounded-lg px-1.5 py-1 transition-colors",
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
          <span className={cn("min-w-0 flex-1 truncate text-sm", active ? "font-medium" : "text-foreground/90")}>
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
                className="shrink-0 opacity-0 transition-opacity group-hover/prow:opacity-100 aria-expanded:opacity-100"
              />
            }
          >
            <MoreHorizontal className="size-3.5" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => setRenaming(true)}>
              <Pencil className="size-3.5" /> {t("rail.rename")}
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
