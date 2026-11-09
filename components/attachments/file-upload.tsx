"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Paperclip, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DEFAULT_MAX_UPLOAD_MB, maxUploadBytes, formatBytes, type AttachmentTarget } from "@/lib/attachments-ui";
import { useUploadAccept } from "@/components/attachments/upload-accept";
import { useServerMessage, useT } from "@/lib/i18n/client";

/** The single form field naming the upload's parent (see app/api/files/upload). */
function targetField(target: AttachmentTarget): [string, string] {
  const [field, value] = Object.entries(target)[0];
  return [field, String(value)];
}

export function FileUpload({
  target, disabled, accept: acceptProp, label, maxMb = DEFAULT_MAX_UPLOAD_MB,
}: {
  target: AttachmentTarget;
  disabled?: boolean;
  accept?: string;
  label?: string;
  /** Client-side pre-check mirror of the server's MAX_UPLOAD_MB setting. */
  maxMb?: number;
}) {
  const maxBytes = maxUploadBytes(maxMb);
  const defaultAccept = useUploadAccept();
  const accept = acceptProp ?? defaultAccept;
  const router = useRouter();
  const t = useT("tickets");
  const tm = useServerMessage();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const uploadOne = (file: File) =>
    new Promise<void>((resolve) => {
      const [field, value] = targetField(target);
      const fd = new FormData();
      fd.set("file", file);
      fd.set(field, value);
      const xhr = new XMLHttpRequest();
      xhr.open("POST", "/api/files/upload");
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) setProgress(Math.round((e.loaded / e.total) * 100));
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve();
        } else {
          try {
            const err = JSON.parse(xhr.responseText)?.error;
            setError(err ? tm(err) : t("attachments.uploadFailed"));
          } catch {
            setError(t("attachments.uploadFailed"));
          }
          resolve();
        }
      };
      xhr.onerror = () => { setError(t("attachments.networkError")); resolve(); };
      xhr.send(fd);
    });

  const onFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setError(null);
    setBusy(true);
    for (const file of Array.from(files)) {
      if (file.size > maxBytes) {
        setError(t("attachments.tooLarge", { name: file.name, max: formatBytes(maxBytes) }));
        continue;
      }
      setProgress(0);
      await uploadOne(file);
    }
    setBusy(false);
    setProgress(0);
    if (inputRef.current) inputRef.current.value = "";
    router.refresh();
  };

  return (
    <div className="grid gap-1.5">
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={accept}
        className="hidden"
        onChange={(e) => onFiles(e.target.files)}
      />
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={disabled || busy}
        onClick={() => inputRef.current?.click()}
      >
        {busy ? <Loader2 className="size-4 animate-spin" /> : <Paperclip className="size-4" />}
        {busy ? t("attachments.uploading", { progress }) : (label ?? t("attachments.attachFile"))}
      </Button>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
