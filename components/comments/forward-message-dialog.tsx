"use client";

import { useState, useTransition } from "react";
import { Forward, Loader2 } from "lucide-react";
import { forwardComment, type ForwardState } from "@/lib/actions/tickets";
import { sanitizeCommentHtml } from "@/lib/markdown";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { useServerMessage, useT } from "@/lib/i18n/client";

/**
 * Per-message Forward (Freshservice-style). Hover a message → forward it to an
 * external party with To/Cc + your note; the quoted message is included. Their
 * reply comes back as a private internal note.
 */
export function ForwardMessageDialog({
  ticketId,
  comment,
  size = "xs",
}: {
  ticketId: number;
  comment: { id: string; author: string; bodyHtml: string | null; body: string };
  /** Trigger size: compact inside a message header, `sm` next to the composer's buttons. */
  size?: "xs" | "sm";
}) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<ForwardState>();
  const [pending, start] = useTransition();
  const t = useT("tickets");
  const tm = useServerMessage();

  const submit = (fd: FormData) => {
    start(async () => {
      const res = await forwardComment(undefined, fd);
      setState(res);
      if (res?.ok) { setOpen(false); setState(undefined); }
    });
  };

  const preview = comment.bodyHtml
    ? sanitizeCommentHtml(comment.bodyHtml)
    : `<p>${comment.body.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</p>`;

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size={size}
        onClick={() => setOpen(true)}
        className="text-muted-foreground"
        title={t("forward.thisMessage")}
      >
        <Forward /> {t("forward.forward")}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("forward.title")}</DialogTitle>
            <DialogDescription>{t("forward.description")}</DialogDescription>
          </DialogHeader>
          <form action={submit} className="grid gap-3">
            <input type="hidden" name="ticketId" value={ticketId} />
            <input type="hidden" name="commentId" value={comment.id} />
            {state?.error ? (
              <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{tm(state.error)}</p>
            ) : null}
            <div className="grid gap-1.5">
              <Label htmlFor="fwd-to">{t("comments.to")}</Label>
              <Input id="fwd-to" name="to" type="email" placeholder="vendor@example.com" required />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="fwd-cc">{t("forward.cc")}</Label>
              <Input id="fwd-cc" name="cc" placeholder="chef@example.com, kollege@example.com" />
            </div>
            <Textarea name="note" placeholder={t("forward.notePlaceholder")} className="min-h-20" />
            <div className="rounded-lg border bg-muted/30 p-2.5">
              <div className="mb-1 text-xs font-medium text-muted-foreground">{t("forward.conversationFrom", { author: comment.author })}</div>
              <div
                className="prose prose-sm dark:prose-invert max-h-40 max-w-none overflow-auto text-muted-foreground"
                dangerouslySetInnerHTML={{ __html: preview }}
              />
            </div>
            <DialogFooter>
              <Button type="submit" disabled={pending}>
                {pending ? <Loader2 className="size-4 animate-spin" /> : <Forward className="size-4" />}
                {t("forward.forward")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
