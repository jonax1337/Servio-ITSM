"use client";

import { useState } from "react";
import { History, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { UserAvatar } from "@/components/user-avatar";
import { ConfirmButton } from "@/components/confirm-dialog";
import { restoreArticleRevision } from "@/lib/actions/knowledge";
import { cn } from "@/lib/utils";
import { useFormatter, useT } from "@/lib/i18n/client";

export type ArticleRevisionRow = {
  id: string;
  version: number;
  title: string;
  excerpt: string | null;
  /** Already sanitized server-side — safe to render directly. */
  html: string;
  note: string | null;
  createdAt: string;
  editor: { name: string | null; email: string | null; image: string | null } | null;
};

/**
 * Revision history viewer for a knowledge article: browse past versions and
 * restore one (non-destructively — restoring writes a new revision, it never
 * deletes history). Revisions are already sanitized server-side before being
 * passed in, so this component just renders them.
 */
export function ArticleHistoryDialog({
  articleId,
  revisions,
}: {
  articleId: string;
  revisions: ArticleRevisionRow[];
}) {
  const [open, setOpen] = useState(false);
  const t = useT("knowledge");
  const f = useFormatter();
  const [selectedId, setSelectedId] = useState<string | null>(revisions[0]?.id ?? null);
  const selected = revisions.find((r) => r.id === selectedId) ?? revisions[0] ?? null;
  const latestVersion = revisions[0]?.version ?? 0;

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (v) setSelectedId(revisions[0]?.id ?? null);
      }}
    >
      <DialogTrigger render={<Button variant="outline" size="sm" />}>
        <History className="size-3.5" /> {t("history")}
        {revisions.length > 0 ? (
          <span className="ml-0.5 rounded-full bg-muted px-1.5 text-xs font-medium text-muted-foreground">
            {revisions.length}
          </span>
        ) : null}
      </DialogTrigger>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{t("revisionHistory")}</DialogTitle>
        </DialogHeader>
        {revisions.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("noRevisions")}</p>
        ) : (
          <div className="grid max-h-[65vh] grid-cols-1 gap-4 overflow-hidden sm:grid-cols-[220px_1fr]">
            <div className="flex flex-col gap-1 overflow-y-auto pr-1 sm:border-r sm:pr-3">
              {revisions.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => setSelectedId(r.id)}
                  className={cn(
                    "flex flex-col items-start gap-0.5 rounded-lg px-2.5 py-2 text-left text-xs transition-colors hover:bg-muted",
                    selected?.id === r.id && "bg-muted",
                  )}
                >
                  <span className="flex items-center gap-1.5 font-medium">
                    v{r.version}
                    {r.version === latestVersion ? (
                      <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
                        {t("current")}
                      </span>
                    ) : null}
                  </span>
                  <span className="text-muted-foreground">{f.date(r.createdAt, "dateTime")}</span>
                  <span className="flex items-center gap-1 text-muted-foreground">
                    <UserAvatar name={r.editor?.name} email={r.editor?.email} image={r.editor?.image} size="xs" />
                    {r.editor?.name ?? r.editor?.email ?? t("unknownEditor")}
                  </span>
                </button>
              ))}
            </div>
            <div className="flex flex-col gap-3 overflow-y-auto pl-1">
              {selected ? (
                <>
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <p className="font-medium">{selected.title}</p>
                      {selected.note ? <p className="text-xs text-muted-foreground">{selected.note}</p> : null}
                    </div>
                    {selected.version !== latestVersion ? (
                      <ConfirmButton
                        action={async (fd) => {
                          await restoreArticleRevision(fd);
                          setOpen(false);
                        }}
                        fields={{ articleId, revisionId: selected.id }}
                        title={t("restoreTitle")}
                        description={t("restoreDescription", { version: selected.version })}
                        confirmLabel={t("restore")}
                        confirmVariant="default"
                        triggerVariant="outline"
                        triggerSize="sm"
                        triggerLabel={t("restoreVersion")}
                      >
                        <RotateCcw className="size-3.5" /> {t("restore")}
                      </ConfirmButton>
                    ) : null}
                  </div>
                  <article
                    className="prose prose-sm prose-invert max-w-none rounded-lg border bg-card p-4 dark:prose-invert"
                    dangerouslySetInnerHTML={{ __html: selected.html }}
                  />
                </>
              ) : null}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
