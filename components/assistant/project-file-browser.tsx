"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
  ChevronDown,
  ChevronRight,
  File as FileIcon,
  FileUp,
  Folder,
  FolderInput,
  FolderOpen,
  FolderPlus,
  FolderUp,
  Loader2,
  MoreHorizontal,
  Pencil,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { SableMark } from "@/components/sable-mark";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ConfirmButton, ConfirmDialog } from "@/components/confirm-dialog";
import { NameDialog } from "./name-dialog";
import { FilePreview, useFilePreview, type PreviewFile } from "@/components/file-preview";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import {
  listProjectFiles,
  createProjectFolder,
  renameProjectFolder,
  deleteProjectFolder,
  moveProjectFile,
  deleteProjectFile,
  moveProjectFiles,
  deleteProjectFiles,
  type ProjectFolderSummary,
  type ProjectFileSummary,
} from "@/lib/actions/ai-project-files";

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** A project file mapped to the shared preview lightbox's shape. The preview/download
 *  URL is keyed by the blob's Attachment id, NOT the AiProjectFile id. */
function toPreviewFile(f: ProjectFileSummary): PreviewFile {
  return { id: f.attachmentId, name: f.name, mime: f.mime, size: f.size };
}

/** Shared props threaded to every (recursive) folder node. */
type TreeCtx = {
  allFolders: ProjectFolderSummary[];
  byFolder: Record<string, ProjectFileSummary[]>;
  expanded: Record<string, boolean>;
  toggle: (id: string) => void;
  onChanged: () => void;
  onUpload: (files: FileList, folderId: string | null) => void;
  /** Open the shared preview lightbox for a file (navigable across all files). */
  onPreview: (file: ProjectFileSummary) => void;
  /** Multi-select: whether a file id is selected + toggle it. */
  isSelected: (id: string) => boolean;
  toggleSelect: (id: string) => void;
};

/**
 * A foldered file browser for a Sable Project: a nested folder tree + files, with
 * create/rename/delete folder, file upload AND folder upload (webkitdirectory,
 * structure preserved), drag-to-move between folders, and per-file delete. All
 * mutations are access-checked server-side.
 */
export function ProjectFileBrowser({ projectId }: { projectId: string }) {
  const [folders, setFolders] = useState<ProjectFolderSummary[]>([]);
  const [files, setFiles] = useState<ProjectFileSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [dragging, setDragging] = useState<ProjectFileSummary | null>(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number; name: string } | null>(null);
  const [dropActive, setDropActive] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);

  const toggleSelect = useCallback((id: string) => {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);
  const clearSelection = useCallback(() => setSelected(new Set()), []);
  const [createFolderOpen, setCreateFolderOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const preview = useFilePreview();

  // A click (no drag movement) on a file row opens the shared preview lightbox.
  // The whole file list is passed so the lightbox can navigate prev/next.
  const openPreview = useCallback(
    (file: ProjectFileSummary) => {
      preview.openFile(
        toPreviewFile(file),
        files.map(toPreviewFile),
      );
    },
    [preview, files],
  );

  // `webkitdirectory` / `directory` aren't typed React attributes — set them via a
  // ref CALLBACK (runs whenever the node mounts) so they apply regardless of the
  // loading spinner timing (a mount effect would fire while the input is unmounted).
  const setFolderInput = useCallback((el: HTMLInputElement | null) => {
    folderInputRef.current = el;
    if (el) {
      el.setAttribute("webkitdirectory", "");
      el.setAttribute("directory", "");
    }
  }, []);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const reload = useCallback(async () => {
    const res = await listProjectFiles(projectId);
    setFolders(res.folders);
    setFiles(res.files);
  }, [projectId]);

  useEffect(() => {
    let ignore = false;
    listProjectFiles(projectId)
      .then((res) => {
        if (ignore) return;
        setFolders(res.folders);
        setFiles(res.files);
      })
      .finally(() => {
        if (!ignore) setLoading(false);
      });
    return () => {
      ignore = true;
    };
  }, [projectId]);

  const rootFolders = folders.filter((f) => !f.parentId);
  const rootFiles = files.filter((f) => !f.folderId);
  const byFolder: Record<string, ProjectFileSummary[]> = {};
  for (const f of folders) byFolder[f.id] = [];
  for (const file of files) if (file.folderId && byFolder[file.folderId]) byFolder[file.folderId].push(file);

  const toggle = useCallback((id: string) => setExpanded((s) => ({ ...s, [id]: !s[id] })), []);

  async function uploadFiles(list: FileList | File[], folderId: string | null) {
    const arr = Array.from(list);
    if (arr.length === 0) return;
    setUploading(true);
    let failed = 0;
    let done = 0;
    for (const file of arr) {
      setProgress({ done, total: arr.length, name: file.name });
      const fd = new FormData();
      fd.set("file", file);
      fd.set("aiProjectId", projectId);
      if (folderId) fd.set("aiProjectFolderId", folderId);
      try {
        const res = await fetch("/api/files/upload", { method: "POST", body: fd });
        if (!res.ok) {
          failed++;
          const body = (await res.json().catch(() => null)) as { error?: string } | null;
          toast.error(body?.error ?? `Could not upload ${file.name}`);
        }
      } catch {
        failed++;
        toast.error(`Could not upload ${file.name}`);
      }
      done++;
    }
    setUploading(false);
    setProgress(null);
    await reload();
    if (failed === 0) toast.success(arr.length > 1 ? `Uploaded ${arr.length} files` : "File uploaded");
  }

  // Upload a whole folder: recreate its folder structure (deduped) under the given
  // parent, then upload each file into the folder its relative path maps to.
  async function uploadFolder(list: FileList) {
    const arr = Array.from(list);
    if (arr.length === 0) return;
    setUploading(true);
    const dirToId = new Map<string, string | null>();
    dirToId.set("", null);

    const ensureDir = async (path: string): Promise<string | null> => {
      if (dirToId.has(path)) return dirToId.get(path) ?? null;
      const parts = path.split("/");
      const name = parts.pop() as string;
      const parentId = await ensureDir(parts.join("/"));
      const res = await createProjectFolder(projectId, parentId ?? undefined, name);
      const id = res.ok ? res.folder.id : null;
      dirToId.set(path, id);
      return id;
    };

    let failed = 0;
    let done = 0;
    for (const file of arr) {
      setProgress({ done, total: arr.length, name: file.name });
      const rel =
        (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
      const segs = rel.split("/").filter(Boolean);
      segs.pop(); // drop the filename → directory path
      const folderId = await ensureDir(segs.join("/"));
      const fd = new FormData();
      fd.set("file", file);
      fd.set("aiProjectId", projectId);
      if (folderId) fd.set("aiProjectFolderId", folderId);
      try {
        const res = await fetch("/api/files/upload", { method: "POST", body: fd });
        if (!res.ok) failed++;
      } catch {
        failed++;
      }
      done++;
    }
    setUploading(false);
    setProgress(null);
    // Reveal the newly created top-level folders.
    setExpanded((s) => {
      const next = { ...s };
      for (const [path, id] of dirToId) if (!path.includes("/") && id) next[id] = true;
      return next;
    });
    await reload();
    if (failed === 0) toast.success(`Uploaded folder (${arr.length} files)`);
    else toast.error(`${failed} of ${arr.length} files failed to upload`);
  }

  function onDragStart(e: DragStartEvent) {
    setDragging(files.find((f) => f.id === e.active.id) ?? null);
  }
  async function onDragEnd(e: DragEndEvent) {
    setDragging(null);
    const overId = e.over?.id ? String(e.over.id) : null;
    const fileId = String(e.active.id);
    const file = files.find((f) => f.id === fileId);
    if (!file || !overId) return;
    const target = overId === "root" ? null : overId.startsWith("folder:") ? overId.slice(7) : undefined;
    if (target === undefined || target === (file.folderId ?? null)) return;
    setFiles((fs) => fs.map((f) => (f.id === fileId ? { ...f, folderId: target } : f)));
    const res = await moveProjectFile(fileId, target);
    if (!res.ok) {
      toast.error(res.error ?? "Could not move");
      void reload();
    } else if (target) {
      setExpanded((s) => ({ ...s, [target]: true }));
    }
  }

  async function onCreateFolder(name: string) {
    const res = await createProjectFolder(projectId, undefined, name);
    if (!res.ok) {
      toast.error(res.error ?? "Could not create folder");
      return;
    }
    setFolders((f) => [...f, res.folder]);
    setExpanded((s) => ({ ...s, [res.folder.id]: true }));
  }

  if (loading) {
    return (
      <div className="grid place-items-center py-10">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  async function bulkMove(folderId: string | null) {
    const ids = [...selected];
    if (!ids.length) return;
    const res = await moveProjectFiles(ids, folderId);
    if (res.ok) {
      clearSelection();
      await reload();
      toast.success(`Moved ${res.count ?? ids.length} file${(res.count ?? ids.length) === 1 ? "" : "s"}`);
    } else {
      toast.error(res.error ?? "Could not move");
    }
  }
  async function bulkDelete() {
    const ids = [...selected];
    if (!ids.length) return;
    const res = await deleteProjectFiles(ids);
    if (res.ok) {
      clearSelection();
      await reload();
    } else {
      toast.error(res.error ?? "Could not delete");
    }
  }

  const ctx: TreeCtx = {
    allFolders: folders,
    byFolder,
    expanded,
    toggle,
    onChanged: reload,
    onUpload: (fl, fid) => void uploadFiles(fl, fid),
    onPreview: openPreview,
    isSelected: (id) => selected.has(id),
    toggleSelect,
  };

  return (
    <DndContext
      id="sable-project-files-dnd"
      sensors={sensors}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
    >
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files) void uploadFiles(e.target.files, null);
          e.target.value = "";
        }}
      />
      <input
        ref={setFolderInput}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files) void uploadFolder(e.target.files);
          e.target.value = "";
        }}
      />

      <NameDialog
        open={createFolderOpen}
        onOpenChange={setCreateFolderOpen}
        title="New folder"
        label="Folder name"
        placeholder="e.g. Runbooks"
        submitLabel="Create folder"
        onSubmit={onCreateFolder}
      />

      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <FolderOpen className="size-4 text-muted-foreground" /> Files
          </h2>
          <div className="flex items-center gap-1">
            <Button
              type="button"
              size="xs"
              variant="ghost"
              onClick={() => setCreateFolderOpen(true)}
              className="text-muted-foreground hover:text-foreground"
            >
              <FolderPlus className="size-3.5" /> New folder
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={<Button type="button" size="xs" variant="outline" disabled={uploading} />}
              >
                {uploading ? <Loader2 className="size-3.5 animate-spin" /> : <Upload className="size-3.5" />}
                Upload
                <ChevronDown className="size-3 opacity-60" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => fileInputRef.current?.click()}>
                  <FileUp className="size-3.5" /> Files
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => folderInputRef.current?.click()}>
                  <FolderUp className="size-3.5" /> Folder
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {/* Bulk-selection bar */}
        {selected.size > 0 ? (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-sable/25 bg-sable-muted/30 px-2.5 py-1.5 text-xs">
            <span className="font-medium">{selected.size} selected</span>
            <div className="ml-auto flex items-center gap-1">
              <DropdownMenu>
                <DropdownMenuTrigger render={<Button type="button" size="xs" variant="ghost" />}>
                  <FolderInput className="size-3.5" /> Move to <ChevronDown className="size-3 opacity-60" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => void bulkMove(null)}>
                    <FolderOpen className="size-3.5" /> Project root
                  </DropdownMenuItem>
                  {folders.map((f) => (
                    <DropdownMenuItem key={f.id} onClick={() => void bulkMove(f.id)}>
                      <Folder className="size-3.5" /> {f.name}
                    </DropdownMenuItem>
                  ))}
                  {folders.length === 0 ? <DropdownMenuItem disabled>No folders</DropdownMenuItem> : null}
                </DropdownMenuContent>
              </DropdownMenu>
              <Button
                type="button"
                size="xs"
                variant="ghost"
                onClick={() => setBulkDeleteOpen(true)}
                className="text-destructive hover:text-destructive"
              >
                <Trash2 className="size-3.5" /> Delete
              </Button>
              <Button type="button" size="icon-xs" variant="ghost" onClick={clearSelection} aria-label="Clear selection">
                <X className="size-3.5" />
              </Button>
            </div>
          </div>
        ) : null}

        {/* Upload progress tracker */}
        {progress ? (
          <div className="space-y-1.5 rounded-lg border bg-muted/20 px-3 py-2">
            <div className="flex items-center justify-between gap-2 text-xs">
              <span className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
                <Loader2 className="size-3.5 shrink-0 animate-spin text-sable" />
                <span className="truncate">Uploading {progress.name}…</span>
              </span>
              <span className="shrink-0 tabular-nums text-muted-foreground">
                {progress.done}/{progress.total}
              </span>
            </div>
            <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-sable transition-[width] duration-200"
                style={{ width: `${Math.round((progress.done / progress.total) * 100)}%` }}
              />
            </div>
          </div>
        ) : null}

        {/* Dropzone / root droppable */}
        <RootDrop
          onFiles={(fl) => void uploadFiles(fl, null)}
          dropActive={dropActive}
          setDropActive={setDropActive}
        >
          {folders.length === 0 && files.length === 0 ? (
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="flex w-full flex-col items-center gap-1.5 rounded-lg border border-dashed border-sable/30 bg-sable-muted/20 px-3 py-6 text-center transition-colors hover:bg-sable-muted/40"
            >
              <Upload className="size-5 text-sable" />
              <span className="text-sm font-medium">Drop files or click to upload</span>
              <span className="text-xs text-muted-foreground">
                Files and folders — Sable indexes them to ground answers in this project.
              </span>
            </button>
          ) : (
            <div className="space-y-0.5">
              {rootFolders.map((folder) => (
                <FolderNode key={folder.id} folder={folder} ctx={ctx} depth={0} />
              ))}
              {rootFiles.map((file) => (
                <FileRow
                  key={file.id}
                  file={file}
                  onChanged={reload}
                  onPreview={openPreview}
                  selected={selected.has(file.id)}
                  onToggleSelect={() => toggleSelect(file.id)}
                />
              ))}
            </div>
          )}
        </RootDrop>
      </div>

      <DragOverlay dropAnimation={null}>
        {dragging ? (
          <div className="pointer-events-none flex max-w-56 items-center gap-2 rounded-lg border bg-popover px-2 py-1.5 text-sm shadow-lg">
            <FileIcon className="size-3.5 shrink-0 text-sable" />
            <span className="truncate">{dragging.name}</span>
          </div>
        ) : null}
      </DragOverlay>

      <FilePreview {...preview.props} />

      <ConfirmDialog
        open={bulkDeleteOpen}
        onOpenChange={setBulkDeleteOpen}
        onConfirm={bulkDelete}
        title={`Delete ${selected.size} file${selected.size === 1 ? "" : "s"}?`}
        description="The selected files and their indexed content are permanently removed."
        confirmLabel="Delete files"
      />
    </DndContext>
  );
}

function RootDrop({
  children,
  onFiles,
  dropActive,
  setDropActive,
}: {
  children: React.ReactNode;
  onFiles: (files: FileList) => void;
  dropActive: boolean;
  setDropActive: (v: boolean) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: "root" });
  return (
    <div
      ref={setNodeRef}
      onDragOver={(e) => {
        if (e.dataTransfer?.types.includes("Files")) {
          e.preventDefault();
          setDropActive(true);
        }
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropActive(false);
      }}
      onDrop={(e) => {
        if (e.dataTransfer?.files?.length) {
          e.preventDefault();
          onFiles(e.dataTransfer.files);
        }
        setDropActive(false);
      }}
      className={cn(
        "rounded-lg transition-colors",
        (isOver || dropActive) && "bg-sable-muted/40 ring-1 ring-sable/30",
      )}
    >
      {children}
    </div>
  );
}

function FolderNode({
  folder,
  ctx,
  depth,
}: {
  folder: ProjectFolderSummary;
  ctx: TreeCtx;
  depth: number;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `folder:${folder.id}` });
  const [renaming, setRenaming] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [alsoFiles, setAlsoFiles] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const files = ctx.byFolder[folder.id] ?? [];
  const children = ctx.allFolders.filter((f) => f.parentId === folder.id);
  const open = ctx.expanded[folder.id] ?? false;
  const empty = files.length === 0 && children.length === 0;

  // Files in this folder AND all its descendants (for the "also delete" option).
  const subtreeFileCount = (() => {
    const stack = [folder.id];
    const seen = new Set<string>();
    let n = 0;
    while (stack.length) {
      const cur = stack.pop()!;
      if (seen.has(cur)) continue;
      seen.add(cur);
      n += ctx.byFolder[cur]?.length ?? 0;
      for (const f of ctx.allFolders) if (f.parentId === cur) stack.push(f.id);
    }
    return n;
  })();

  async function removeFolder() {
    setDeleting(true);
    const res = await deleteProjectFolder(folder.id, alsoFiles);
    setDeleting(false);
    setConfirmDelete(false);
    if (res.ok) ctx.onChanged();
    else toast.error(res.error ?? "Could not delete");
  }

  async function rename(next: string) {
    if (next === folder.name) return;
    const res = await renameProjectFolder(folder.id, next);
    if (res.ok) ctx.onChanged();
    else toast.error(res.error ?? "Could not rename");
  }

  return (
    <div
      ref={setNodeRef}
      onDragOver={(e) => {
        if (e.dataTransfer?.types.includes("Files")) e.preventDefault();
      }}
      onDrop={(e) => {
        if (e.dataTransfer?.files?.length) {
          e.preventDefault();
          e.stopPropagation();
          ctx.onUpload(e.dataTransfer.files, folder.id);
        }
      }}
      className={cn("rounded-lg transition-colors", isOver && "bg-sable-muted/60 ring-1 ring-border")}
    >
      <div className="group/folder flex items-center gap-1 rounded-lg px-1.5 py-1 transition-colors hover:bg-muted/60">
        <button type="button" onClick={() => ctx.toggle(folder.id)} className="flex min-w-0 flex-1 items-center gap-1.5 text-left">
          <ChevronRight className={cn("size-3 shrink-0 text-muted-foreground transition-transform", open && "rotate-90")} />
          <Folder className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate text-sm font-medium">{folder.name}</span>
          {files.length ? <span className="text-[11px] text-muted-foreground">{files.length}</span> : null}
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                type="button"
                size="icon-xs"
                variant="ghost"
                aria-label="Folder options"
                className="shrink-0 opacity-0 transition-opacity group-hover/folder:opacity-100 aria-expanded:opacity-100"
              />
            }
          >
            <MoreHorizontal className="size-3.5" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => setRenaming(true)}>
              <Pencil className="size-3.5" /> Rename
            </DropdownMenuItem>
            <DropdownMenuItem
              variant="destructive"
              onClick={() => {
                setAlsoFiles(false);
                setConfirmDelete(true);
              }}
            >
              <Trash2 className="size-3.5" /> Delete folder
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <NameDialog
        open={renaming}
        onOpenChange={setRenaming}
        title="Rename folder"
        label="Folder name"
        initialValue={folder.name}
        submitLabel="Rename"
        onSubmit={rename}
      />

      <Dialog open={confirmDelete} onOpenChange={(v) => { if (!deleting) setConfirmDelete(v); }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete folder?</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              {subtreeFileCount > 0
                ? `"${folder.name}" contains ${subtreeFileCount} file${subtreeFileCount === 1 ? "" : "s"}. By default they move to the project root.`
                : `Delete the folder "${folder.name}"?`}
            </p>
            {subtreeFileCount > 0 ? (
              <label className="flex cursor-pointer items-center gap-2 text-sm">
                <Checkbox checked={alsoFiles} onCheckedChange={(v) => setAlsoFiles(v === true)} />
                Also delete the {subtreeFileCount} file{subtreeFileCount === 1 ? "" : "s"} inside
              </label>
            ) : null}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setConfirmDelete(false)} disabled={deleting}>
              Cancel
            </Button>
            <Button type="button" variant="destructive" onClick={removeFolder} disabled={deleting}>
              {deleting ? <Loader2 className="size-4 animate-spin" /> : null}
              {alsoFiles && subtreeFileCount > 0 ? "Delete folder + files" : "Delete folder"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {open ? (
        <div className="ml-3 border-l pl-1">
          {children.map((child) => (
            <FolderNode key={child.id} folder={child} ctx={ctx} depth={depth + 1} />
          ))}
          {empty ? (
            <div
              className={cn(
                "m-1 flex flex-col items-center gap-1 rounded-lg border border-dashed px-3 py-3 text-center transition-colors",
                isOver ? "border-sable/40 bg-sable-muted/40" : "border-border/60",
              )}
            >
              <Upload className="size-3.5 text-muted-foreground/50" />
              <span className="text-[11px] text-muted-foreground">Drop files here</span>
            </div>
          ) : (
            files.map((file) => (
              <FileRow
                key={file.id}
                file={file}
                onChanged={ctx.onChanged}
                onPreview={ctx.onPreview}
                selected={ctx.isSelected(file.id)}
                onToggleSelect={() => ctx.toggleSelect(file.id)}
              />
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}

function FileRow({
  file,
  onChanged,
  onPreview,
  selected,
  onToggleSelect,
}: {
  file: ProjectFileSummary;
  onChanged: () => void;
  onPreview: (file: ProjectFileSummary) => void;
  selected: boolean;
  onToggleSelect: () => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: file.id });

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "group/file flex items-center gap-2 rounded-lg px-1.5 py-1 transition-colors",
        selected ? "bg-sable-muted/40" : "hover:bg-muted/60",
        isDragging && "opacity-40",
      )}
    >
      <span
        onClick={(e) => e.stopPropagation()}
        className={cn(
          "flex shrink-0 items-center transition-opacity",
          selected ? "opacity-100" : "opacity-0 group-hover/file:opacity-100",
        )}
      >
        <Checkbox checked={selected} onCheckedChange={() => onToggleSelect()} aria-label={`Select ${file.name}`} />
      </span>
      {/*
        The drag listeners live on this button, but the PointerSensor's 6px
        activation distance means a plain click never starts a drag (and dnd-kit
        suppresses the click after a real drag) — so onClick opens the preview
        without conflicting with drag-to-move.
      */}
      <button
        type="button"
        {...attributes}
        {...listeners}
        onClick={() => onPreview(file)}
        className="flex min-w-0 flex-1 items-center gap-2 text-left"
        title={file.name}
      >
        <FileIcon className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate text-sm">{file.name}</span>
        {file.tag ? (
          <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
            {file.tag}
          </span>
        ) : null}
        {file.indexedAt ? (
          <SableMark className="size-3.5 shrink-0 text-sable" aria-label="Indexed" />
        ) : null}
        <span className="shrink-0 text-[11px] text-muted-foreground">{humanSize(file.size)}</span>
      </button>
      <ConfirmButton
        action={async () => {
          const res = await deleteProjectFile(file.id);
          if (res.ok) onChanged();
          else toast.error(res.error ?? "Could not delete");
        }}
        title="Delete file?"
        description={`"${file.name}" will be removed from this project, including its indexed content.`}
        confirmLabel="Delete"
        triggerVariant="ghost"
        triggerSize="icon-xs"
        triggerClassName="shrink-0 text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover/file:opacity-100"
        triggerLabel="Delete file"
      >
        <Trash2 className="size-3.5" />
      </ConfirmButton>
    </div>
  );
}
