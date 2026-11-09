"use client";

import { useMemo } from "react";
import {
  CompositeAttachmentAdapter,
  SimpleImageAttachmentAdapter,
  SimpleTextAttachmentAdapter,
  WebSpeechDictationAdapter,
  type AttachmentAdapter,
  type CompleteAttachment,
  type PendingAttachment,
} from "@assistant-ui/react";
import { useUploadAccept } from "@/components/attachments/upload-accept";

/** Read a File as a base64 data URL (works with or without FileReader). */
async function fileToDataURL(file: File): Promise<string> {
  if (typeof FileReader === "undefined") {
    const buf = new Uint8Array(await file.arrayBuffer());
    let binary = "";
    const chunk = 0x8000;
    for (let i = 0; i < buf.length; i += chunk) {
      binary += String.fromCharCode(...buf.subarray(i, i + chunk));
    }
    const b64 = typeof btoa !== "undefined" ? btoa(binary) : Buffer.from(buf).toString("base64");
    return `data:${file.type || "application/octet-stream"};base64,${b64}`;
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

/**
 * Fallback adapter for everything the image/text adapters don't cover (PDF,
 * Office/OpenDocument, archives, media, …). Emits a `file` content part carrying
 * a base64 data URL so the composer accepts the broadened set from
 * UPLOAD_ACCEPT — matching the rest of the app / lib/files.ts. The server-side
 * validateUpload stays the authoritative gate for what is actually stored.
 */
class SableDocumentAttachmentAdapter implements AttachmentAdapter {
  // Accept anything here; ordering in the composite means images + plain text
  // are handled by their dedicated adapters first, and this catches the rest.
  constructor(readonly accept: string) {}

  async add({ file }: { file: File }): Promise<PendingAttachment> {
    return {
      id: crypto.randomUUID(),
      type: "document",
      name: file.name,
      contentType: file.type || "application/octet-stream",
      file,
      status: { type: "requires-action", reason: "composer-send" },
    };
  }

  async send(attachment: PendingAttachment): Promise<CompleteAttachment> {
    const data = await fileToDataURL(attachment.file);
    return {
      ...attachment,
      status: { type: "complete" },
      content: [
        {
          type: "file",
          filename: attachment.name,
          data,
          mimeType: attachment.file.type || "application/octet-stream",
        },
      ],
    };
  }

  async remove(): Promise<void> {}
}

/**
 * The chat runtime adapters shared by the console and portal Sable threads:
 * image + text + a broadened document fallback (PDF/Office/media/… per
 * UPLOAD_ACCEPT), plus browser-native voice dictation where the Web Speech API
 * is available (which flips on the composer's mic button). Kept in one place so
 * both surfaces stay identical.
 */
export function useSableChatAdapters() {
  const accept = useUploadAccept();
  return useMemo(() => {
    const attachments = new CompositeAttachmentAdapter([
      new SimpleImageAttachmentAdapter(),
      new SimpleTextAttachmentAdapter(),
      // Catch-all last so images/plain text keep their dedicated handling.
      new SableDocumentAttachmentAdapter(accept),
    ]);
    const canDictate =
      typeof window !== "undefined" && WebSpeechDictationAdapter.isSupported();
    return canDictate
      ? { attachments, dictation: new WebSpeechDictationAdapter() }
      : { attachments };
  }, [accept]);
}
