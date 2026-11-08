import { Download, Trash2 } from "lucide-react";
import { ConfirmButton } from "@/components/confirm-dialog";
import { AttachmentFilenameLink } from "@/components/attachments/attachment-list-row";
import { deleteAttachment } from "@/lib/actions/attachments";
import { formatBytes, iconForMime, type AttachmentRow } from "@/lib/attachments-ui";
import { getFormatter, getT } from "@/lib/i18n/server";

/** Server Component. */
export async function AttachmentList({
  attachments, canDeleteAll = false, currentUserId, emptyLabel,
}: {
  attachments: AttachmentRow[];
  /** Agents: may delete any attachment. */
  canDeleteAll?: boolean;
  /** Non-agents: may delete only their own uploads (matches deleteAttachment authz). */
  currentUserId?: string;
  emptyLabel?: string;
}) {
  const [t, f] = await Promise.all([getT("tickets"), getFormatter()]);
  if (attachments.length === 0) {
    return <p className="text-sm text-muted-foreground">{emptyLabel ?? t("attachments.none")}</p>;
  }
  return (
    <ul className="grid gap-1.5">
      {attachments.map((a) => {
        const Icon = iconForMime(a.mime);
        const canDelete = canDeleteAll || (!!currentUserId && a.uploadedById === currentUserId);
        return (
          <li key={a.id} className="group flex items-center gap-3 rounded-lg border px-3 py-2">
            <Icon className="size-4 shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <AttachmentFilenameLink attachment={a} siblings={attachments} />
              <div className="text-xs text-muted-foreground">
                {formatBytes(a.size)} · {f.relative(a.createdAt)}
              </div>
            </div>
            <a
              href={`/api/files/${a.id}`}
              download
              aria-label={t("attachments.download", { name: a.filename })}
              className="text-muted-foreground opacity-0 transition-opacity hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
            >
              <Download className="size-4" />
            </a>
            {canDelete ? (
              <ConfirmButton
                action={deleteAttachment}
                fields={{ id: a.id }}
                title={t("attachments.removeTitle")}
                description={t("tasks.deleteDescription", { title: a.filename })}
                confirmLabel={t("work.remove")}
                triggerVariant="ghost"
                triggerSize="icon-xs"
                triggerClassName="opacity-0 transition-opacity group-hover:opacity-100"
                triggerLabel={t("attachments.removeAttachment")}
              >
                <Trash2 className="size-3.5" />
              </ConfirmButton>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
