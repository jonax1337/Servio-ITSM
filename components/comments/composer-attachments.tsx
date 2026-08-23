"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Paperclip, X, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { deleteAttachment } from "@/lib/actions/attachments";
import { DEFAULT_MAX_UPLOAD_MB, maxUploadBytes, UPLOAD_ACCEPT, formatBytes } from "@/lib/attachments-ui";

type Staged = { id: string; filename: string };

/**
 * Stages files onto the ticket while composing a comment (uploads immediately),
 * surfaces their ids as hidden `attachmentIds` inputs, and the comment action
 * re-parents them onto the created comment. Clears on the form's reset (after send).
 */
export function ComposerAttachments({
  ticketId,
  layout = "block",
  maxMb = DEFAULT_MAX_UPLOAD_MB,
}: {
  ticketId: number;
  /** "block" stacks chips above a full trigger (portal). "inline" keeps the
   *  trigger and chips on one row so it can live in the composer footer. */
  layout?: "block" | "inline";
  /** Client-side pre-check mirror of the server's MAX_UPLOAD_MB setting. */
  maxMb?: number;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const [files, setFiles] = useState<Staged[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, startDelete] = useTransition();
  const maxBytes = maxUploadBytes(maxMb);

  useEffect(() => {
    const form = rootRef.current?.closest("form");
    if (!form) return;
    const onReset = () => setFiles([]);
    form.addEventListener("reset", onReset);
    return () => form.removeEventListener("reset", onReset);
  }, []);

  const upload = (file: File) =>
    new Promise<void>((resolve) => {
      const fd = new FormData();
      fd.set("file", file);
      fd.set("ticketId", String(ticketId));
      const xhr = new XMLHttpRequest();
      xhr.open("POST", "/api/files/upload");
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            const r = JSON.parse(xhr.responseText);
            setFiles((f) => [...f, { id: r.id, filename: r.filename }]);
          } catch { /* ignore parse error */ }
        } else {
          try { setError(JSON.parse(xhr.responseText)?.error ?? "Upload failed."); } catch { setError("Upload failed."); }
        }
        resolve();
      };
      xhr.onerror = () => { setError("Network error during upload."); resolve(); };
      xhr.send(fd);
    });

  const onFiles = async (list: FileList | null) => {
    if (!list || list.length === 0) return;
    setError(null);
    setBusy(true);
    for (const file of Array.from(list)) {
      if (file.size > maxBytes) { setError(`${file.name} is larger than ${formatBytes(maxBytes)}.`); continue; }
      await upload(file);
    }
    setBusy(false);
    if (inputRef.current) inputRef.current.value = "";
  };

  const remove = (id: string) => {
    setFiles((f) => f.filter((x) => x.id !== id));
    const fd = new FormData();
    fd.set("id", id);
    startDelete(() => { void deleteAttachment(fd); });
  };

  const hiddenInputs = (
    <>
      <input ref={inputRef} type="file" multiple accept={UPLOAD_ACCEPT} className="hidden" onChange={(e) => onFiles(e.target.files)} />
      {files.map((f) => (
        <input key={f.id} type="hidden" name="attachmentIds" value={f.id} />
      ))}
    </>
  );

  const chips = files.map((f) => (
    <span key={f.id} className="inline-flex items-center gap-1 rounded-md border bg-muted/40 px-2 py-1 text-xs">
      <Paperclip className="size-3 shrink-0" />
      <span className="max-w-40 truncate">{f.filename}</span>
      <button type="button" onClick={() => remove(f.id)} aria-label={`Remove ${f.filename}`} className="text-muted-foreground hover:text-foreground">
        <X className="size-3" />
      </button>
    </span>
  ));

  const trigger = (
    <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => inputRef.current?.click()}>
      {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Paperclip className="size-3.5" />}
      Attach files
    </Button>
  );

  if (layout === "inline") {
    return (
      <div ref={rootRef} className="flex flex-wrap items-center gap-1.5">
        {hiddenInputs}
        {trigger}
        {chips}
        {error ? <p className="basis-full text-xs text-destructive">{error}</p> : null}
      </div>
    );
  }

  return (
    <div ref={rootRef} className="grid gap-1.5">
      {hiddenInputs}
      {files.length > 0 ? <div className="flex flex-wrap gap-1.5">{chips}</div> : null}
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
      <div className="justify-self-start">{trigger}</div>
    </div>
  );
}
