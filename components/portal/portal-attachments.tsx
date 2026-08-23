"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { X, Loader2, UploadCloud } from "lucide-react";
import { deleteAttachment } from "@/lib/actions/attachments";
import { iconForMime, formatBytes, DEFAULT_MAX_UPLOAD_MB, maxUploadBytes, UPLOAD_ACCEPT } from "@/lib/attachments-ui";
import { FilePreview, useFilePreview, canPreview, type PreviewFile } from "@/components/file-preview";
import { cn } from "@/lib/utils";

type Staged = { id: string; filename: string; mime: string; size: number; previewUrl?: string };

/**
 * Stages files for a not-yet-created request: uploads each immediately to the
 * server with NO parent (owned by the uploader), then surfaces their ids as
 * hidden `attachmentIds` inputs. The create action re-parents them onto the new
 * ticket. Clears on the form's reset.
 */
export function PortalAttachments({ maxMb = DEFAULT_MAX_UPLOAD_MB }: {
  /** Client-side pre-check mirror of the server's MAX_UPLOAD_MB setting. */
  maxMb?: number;
}) {
  const maxBytes = maxUploadBytes(maxMb);
  const inputRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const [files, setFiles] = useState<Staged[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [, startDelete] = useTransition();
  const preview = useFilePreview();

  useEffect(() => {
    const form = rootRef.current?.closest("form");
    if (!form) return;
    const onReset = () => {
      setFiles((prev) => {
        prev.forEach((f) => f.previewUrl && URL.revokeObjectURL(f.previewUrl));
        return [];
      });
    };
    form.addEventListener("reset", onReset);
    return () => form.removeEventListener("reset", onReset);
  }, []);

  const upload = (file: File, previewUrl?: string) =>
    new Promise<void>((resolve) => {
      const fd = new FormData();
      fd.set("file", file); // no target → staging upload
      const xhr = new XMLHttpRequest();
      xhr.open("POST", "/api/files/upload");
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            const r = JSON.parse(xhr.responseText);
            setFiles((f) => [...f, { id: r.id, filename: r.filename, mime: r.mime, size: r.size, previewUrl }]);
          } catch {
            if (previewUrl) URL.revokeObjectURL(previewUrl);
          }
        } else {
          if (previewUrl) URL.revokeObjectURL(previewUrl);
          try { setError(JSON.parse(xhr.responseText)?.error ?? "Upload failed."); } catch { setError("Upload failed."); }
        }
        resolve();
      };
      xhr.onerror = () => { if (previewUrl) URL.revokeObjectURL(previewUrl); setError("Network error during upload."); resolve(); };
      xhr.send(fd);
    });

  const onFiles = async (list: FileList | null) => {
    if (!list || list.length === 0) return;
    setError(null);
    setBusy(true);
    for (const file of Array.from(list)) {
      if (file.size > maxBytes) {
        setError(`${file.name} is larger than ${formatBytes(maxBytes)}.`);
        continue;
      }
      const previewUrl = file.type.startsWith("image/") ? URL.createObjectURL(file) : undefined;
      await upload(file, previewUrl);
    }
    setBusy(false);
    if (inputRef.current) inputRef.current.value = "";
  };

  const remove = (id: string) => {
    setFiles((f) => {
      const gone = f.find((x) => x.id === id);
      if (gone?.previewUrl) URL.revokeObjectURL(gone.previewUrl);
      return f.filter((x) => x.id !== id);
    });
    const fd = new FormData();
    fd.set("id", id);
    startDelete(() => { void deleteAttachment(fd); });
  };

  return (
    <div ref={rootRef} className="grid gap-2">
      {files.map((f) => (
        <input key={f.id} type="hidden" name="attachmentIds" value={f.id} />
      ))}

      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); void onFiles(e.dataTransfer.files); }}
        className={cn(
          "flex flex-col items-center justify-center gap-1 rounded-xl border border-dashed px-4 py-6 text-center transition-colors",
          dragging ? "border-primary bg-primary/5" : "hover:border-primary/40 hover:bg-muted/30",
        )}
      >
        {busy ? (
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        ) : (
          <UploadCloud className="size-5 text-muted-foreground" />
        )}
        <span className="text-sm font-medium">Add a screenshot or file</span>
        <span className="text-xs text-muted-foreground">
          Drag &amp; drop, or click to browse. Images, PDF, Office docs, media &amp; more (max {formatBytes(maxBytes)}).
        </span>
      </button>

      <input ref={inputRef} type="file" multiple accept={UPLOAD_ACCEPT} className="hidden" onChange={(e) => onFiles(e.target.files)} />

      {files.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {files.map((f) => {
            const Icon = iconForMime(f.mime);
            const previewFile: PreviewFile = { id: f.id, name: f.filename, mime: f.mime, size: f.size };
            const canOpen = canPreview(previewFile);
            const thumb = f.previewUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={f.previewUrl} alt="" className="size-8 shrink-0 rounded-md object-cover" />
            ) : (
              <span className="grid size-8 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground">
                <Icon className="size-4" />
              </span>
            );
            const meta = (
              <span className="min-w-0 text-left">
                <span className="block max-w-40 truncate font-medium">{f.filename}</span>
                <span className="block text-muted-foreground">{formatBytes(f.size)}</span>
              </span>
            );
            return (
              <span key={f.id} className="group inline-flex items-center gap-2 rounded-lg border bg-card py-1 pl-1 pr-2 text-xs">
                {canOpen ? (
                  <button
                    type="button"
                    onClick={() => preview.openFile(previewFile)}
                    className="inline-flex items-center gap-2 rounded-md hover:opacity-80"
                    title={`Preview ${f.filename}`}
                  >
                    {thumb}
                    {meta}
                  </button>
                ) : (
                  <>
                    {thumb}
                    {meta}
                  </>
                )}
                <button
                  type="button"
                  onClick={() => remove(f.id)}
                  aria-label={`Remove ${f.filename}`}
                  className="ml-0.5 grid size-5 shrink-0 place-items-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  <X className="size-3.5" />
                </button>
              </span>
            );
          })}
        </div>
      ) : null}

      {error ? <p className="text-xs text-destructive">{error}</p> : null}

      <FilePreview {...preview.props} />
    </div>
  );
}
