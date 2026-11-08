"use client";

import { useRef, useState, useTransition, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { Lock, Send, Loader2, MessageSquare, Activity as ActivityIcon, Wand2, Forward } from "lucide-react";
import { SableMark } from "@/components/sable-mark";
import { toast } from "sonner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { UserAvatar } from "@/components/user-avatar";
import { RichTextEditor, type MentionUser, type RichTextEditorHandle } from "@/components/ui/rich-text-editor";
import { AiButton } from "@/components/ui/ai-button";
import { draftReply, improveText } from "@/lib/actions/ai";
import { ComposerAttachments } from "@/components/comments/composer-attachments";
import { RecipientField } from "@/components/comments/recipient-field";
import { ForwardMessageDialog } from "@/components/comments/forward-message-dialog";
import { Reply, MoreHorizontal } from "lucide-react";
import type { ComboOption } from "@/components/combobox";
import { sanitizeCommentHtml } from "@/lib/markdown";
import { lowerLead } from "@/lib/utils";
import { iconForMime, formatBytes, type AttachmentRow } from "@/lib/attachments-ui";
import { FilePreview, useFilePreview, canPreview, type PreviewFile } from "@/components/file-preview";
import { LocalTime, timeAgo } from "@/components/local-time";
import { useFormatter, useServerMessage, useT } from "@/lib/i18n/client";

export type ThreadComment = {
  id: string;
  author: string;
  body: string;
  bodyHtml: string | null;
  isInternal: boolean;
  /** Set when the comment arrived by email. Internal + fromEmail = external
   *  (forwarded) correspondence, styled distinctly from a plain internal note. */
  fromEmail?: string | null;
  /** WEB | EMAIL | FORWARD — FORWARD marks an outbound "you forwarded this" entry. */
  channel?: string | null;
  /** For a sent message: who it was emailed to (shown as "To / Cc"). */
  recipients?: { to: string; cc: string[] } | null;
  createdAt: Date;
  attachments: AttachmentRow[];
};

function toPreviewFile(a: AttachmentRow): PreviewFile {
  return { id: a.id, name: a.filename, mime: a.mime, size: a.size };
}

function CommentAttachments({ attachments }: { attachments: AttachmentRow[] }) {
  const preview = useFilePreview();
  if (attachments.length === 0) return null;
  const previewable = attachments.filter((a) => canPreview(toPreviewFile(a))).map(toPreviewFile);
  const chipClass =
    "inline-flex items-center gap-1.5 rounded-md border bg-background px-2 py-1 text-xs hover:border-primary/40 hover:text-primary";
  return (
    <div className="mt-1.5 flex flex-wrap gap-1.5">
      {attachments.map((a) => {
        const Icon = iconForMime(a.mime);
        const file = toPreviewFile(a);
        const inner = (
          <>
            <Icon className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="max-w-48 truncate font-medium">{a.filename}</span>
            <span className="text-muted-foreground">{formatBytes(a.size)}</span>
          </>
        );
        return canPreview(file) ? (
          <button key={a.id} type="button" onClick={() => preview.openFile(file, previewable)} className={chipClass}>
            {inner}
          </button>
        ) : (
          <a key={a.id} href={`/api/files/${a.id}`} download className={chipClass}>
            {inner}
          </a>
        );
      })}
      <FilePreview {...preview.props} />
    </div>
  );
}
export type ThreadEvent = { id: string; who: string; summary: string; createdAt: Date };

function SubmitButton({ label }: { label?: string }) {
  const { pending } = useFormStatus();
  const t = useT("tickets");
  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
      {label ?? t("comments.send")}
    </Button>
  );
}

/** AI helpers in the composer footer — only rendered when a ticket id is given
 *  and AI is configured. Draft writes into the editor; Improve rewrites what's
 *  already typed. Both go through the editor handle so the hidden input stays synced. */
function AiComposerButtons({
  ticketId,
  editorRef,
  teaser = false,
}: {
  ticketId: number;
  editorRef: React.RefObject<RichTextEditorHandle | null>;
  teaser?: boolean;
}) {
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<"draft" | "improve" | null>(null);
  const t = useT("tickets");
  const tm = useServerMessage();

  function onDraft() {
    if (teaser) return void toast.info(t("comments.aiTeaser"));
    setBusy("draft");
    start(async () => {
      const res = await draftReply(ticketId);
      setBusy(null);
      if (!res.ok) return void toast.error(tm(res.error));
      editorRef.current?.setHTML(res.html);
      toast.success(t("comments.replyDrafted"));
    });
  }

  function onImprove() {
    if (teaser) return void toast.info(t("comments.aiTeaser"));
    // Prefer the current selection — improve only what the agent highlighted.
    const selection = editorRef.current?.getSelectionText()?.trim() ?? "";
    const hasSelection = selection.length >= 2;
    const text = hasSelection ? selection : (editorRef.current?.getText() ?? "");
    if (text.trim().length < 2) return void toast.error(t("comments.nothingToImprove"));
    setBusy("improve");
    start(async () => {
      const res = await improveText(text);
      setBusy(null);
      if (!res.ok) return void toast.error(tm(res.error));
      if (hasSelection) editorRef.current?.replaceSelection(res.text);
      else editorRef.current?.setText(res.text);
      toast.success(hasSelection ? t("comments.selectionImproved") : t("comments.textImproved"));
    });
  }

  return (
    <div className="flex items-center gap-1.5">
      <AiButton type="button" onClick={onDraft} disabled={pending}>
        {pending && busy === "draft" ? <Loader2 className="size-4 animate-spin" /> : <SableMark className="size-4" />}
        {t("comments.suggestReply")}
      </AiButton>
      <AiButton type="button" onClick={onImprove} disabled={pending} title={t("comments.improveHint")}>
        {pending && busy === "improve" ? <Loader2 className="size-4 animate-spin" /> : <Wand2 className="size-4" />}
        {t("comments.improve")}
      </AiButton>
    </div>
  );
}

export function CommentThread({
  idField,
  entityId,
  comments,
  activity,
  addAction,
  allowInternal = true,
  placeholder: placeholderProp,
  mentionUsers,
  attachTarget,
  aiTicketId,
  aiTeaser = false,
  composerExtra,
  emailReply,
  enableForward = false,
  maxMb,
}: {
  idField: string;
  entityId: number;
  comments: ThreadComment[];
  /** Audit events for an extra Activity sub-tab; omit where the page has its own History tab. */
  activity?: ThreadEvent[];
  addAction: (formData: FormData) => void | Promise<void>;
  allowInternal?: boolean;
  placeholder?: string;
  mentionUsers?: MentionUser[];
  attachTarget?: { ticketId: number };
  /** When set, shows AI reply/improve helpers in the composer. */
  aiTicketId?: number;
  /** When true, the AI buttons are a disabled "teaser" (click shows a hint, no call). */
  aiTeaser?: boolean;
  /** Extra composer action rendered in the footer (generic slot). */
  composerExtra?: ReactNode;
  /** When set, renders the Freshservice-style email reply composer (Reply/Note
   *  modes + visible To/Cc/Bcc). Ticket agent view only. */
  emailReply?: {
    requesterEmail?: string | null;
    participantEmails?: string[];
    candidateUsers: ComboOption[];
  };
  /** Show a per-message "Forward" action (ticket agent view only). */
  enableForward?: boolean;
  /** Client-side pre-check mirror of the server's MAX_UPLOAD_MB setting. */
  maxMb?: number;
}) {
  const ref = useRef<HTMLFormElement>(null);
  const editorRef = useRef<RichTextEditorHandle | null>(null);
  const [isInternal, setIsInternal] = useState(false);
  const [mode, setMode] = useState<"reply" | "note">("reply");
  const [showBcc, setShowBcc] = useState(false);
  const [resetKey, setResetKey] = useState(0); // remounts recipient fields after send
  const [quoteAnchorId, setQuoteAnchorId] = useState<string | null>(null);
  const [showQuote, setShowQuote] = useState(false);
  const [composerOpen, setComposerOpen] = useState(false); // Freshservice-style: collapsed by default
  const composerMounted = !emailReply || composerOpen;
  const t = useT("tickets");
  const tc = useT("common");
  const f = useFormatter();
  const placeholder = placeholderProp ?? t("comments.placeholder");

  // The quoted mail trail (like a mail client's collapsed "•••"): public messages
  // up to and including the reply anchor (defaults to the latest message), newest
  // first. It rides along on the sent email; the editor stays clean.
  const publicComments = comments.filter((m) => !m.isInternal && m.channel !== "FORWARD");
  const latestPublicId = publicComments.length ? publicComments[publicComments.length - 1].id : null;
  const anchorId = quoteAnchorId ?? latestPublicId;
  const anchor = anchorId ? comments.find((m) => m.id === anchorId) : null;
  const quotedTrail = anchor
    ? publicComments
        .filter((m) => m.createdAt.getTime() <= anchor.createdAt.getTime())
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .slice(0, 20)
    : [];

  // Per-message "Antworten": reply mode, anchor the quote at this message, clean editor.
  function replyToMessage(c: ThreadComment) {
    setComposerOpen(true);
    setMode("reply");
    setQuoteAnchorId(c.id);
    setShowQuote(false);
    editorRef.current?.setHTML("");
    editorRef.current?.focus();
    ref.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  return (
    <Tabs defaultValue="comments">
      {activity ? (
      <TabsList>
        <TabsTrigger value="comments">
          <MessageSquare className="size-4" /> {tc("comments")}
          <span className="ml-1 rounded-full bg-muted px-1.5 text-xs tabular-nums">{comments.length}</span>
        </TabsTrigger>
        <TabsTrigger value="activity">
          <ActivityIcon className="size-4" /> {t("comments.activity")}
          <span className="ml-1 rounded-full bg-muted px-1.5 text-xs tabular-nums">{activity.length}</span>
        </TabsTrigger>
      </TabsList>
      ) : null}

      <TabsContent value="comments" className={activity ? "mt-4" : undefined}>
        <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
          {comments.map((c) => {
            // FORWARD = an outbound "you forwarded this" entry (primary). External =
            // an internal reply that came in by email from a forwarded party (Ice tint).
            // Both are distinct from a plain internal note (amber).
            const forwarded = c.channel === "FORWARD";
            const external = c.isInternal && !!c.fromEmail && !forwarded;
            return (
            <div key={c.id} className="group flex gap-3">
              <UserAvatar name={c.author} className="shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{c.author}</span>
                  {forwarded ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                      <Forward className="size-2.5" /> {t("comments.forwarded")}
                    </span>
                  ) : external ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-brand-ice/20 px-1.5 py-0.5 text-[10px] font-medium text-sable">
                      <Forward className="size-2.5" /> {t("comments.external")}
                    </span>
                  ) : c.isInternal ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-600 dark:text-amber-400">
                      <Lock className="size-2.5" /> {t("comments.internal")}
                    </span>
                  ) : null}
                  <span className="text-xs text-muted-foreground"><LocalTime date={c.createdAt} render={timeAgo} /></span>
                  {(emailReply || enableForward) && !forwarded ? (
                    <span className="ml-auto flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                      {emailReply ? (
                        <button
                          type="button"
                          onClick={() => replyToMessage(c)}
                          className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-muted-foreground hover:text-foreground"
                          title={t("comments.replyToMessage")}
                        >
                          <Reply className="size-3.5" /> {t("comments.reply")}
                        </button>
                      ) : null}
                      {enableForward ? (
                        <ForwardMessageDialog ticketId={entityId} comment={{ id: c.id, author: c.author, bodyHtml: c.bodyHtml, body: c.body }} />
                      ) : null}
                    </span>
                  ) : null}
                </div>
                {c.recipients ? (
                  <div className="mt-0.5 truncate text-xs text-muted-foreground" title={`${t("comments.to")}: ${c.recipients.to}${c.recipients.cc.length ? `\nCc: ${c.recipients.cc.join(", ")}` : ""}`}>
                    {t("comments.to")}: {c.recipients.to}
                    {c.recipients.cc.length ? <span> · Cc: {c.recipients.cc.join(", ")}</span> : null}
                  </div>
                ) : null}
                <div className={`mt-1 rounded-lg border p-3 text-sm ${forwarded ? "border-primary/20 bg-primary/5" : external ? "border-brand-ice/40 bg-brand-ice/10" : c.isInternal ? "border-amber-500/20 bg-amber-500/5" : "bg-card"}`}>
                  {c.bodyHtml ? (
                    <div
                      className="prose prose-sm dark:prose-invert max-w-none wrap-anywhere prose-pre:overflow-x-auto prose-table:block prose-table:overflow-x-auto [&_[data-mention-id]]:rounded [&_[data-mention-id]]:bg-primary/10 [&_[data-mention-id]]:px-1 [&_[data-mention-id]]:font-medium [&_[data-mention-id]]:text-primary"
                      dangerouslySetInnerHTML={{ __html: sanitizeCommentHtml(c.bodyHtml) }}
                    />
                  ) : (
                    <div className="whitespace-pre-wrap wrap-anywhere">{c.body}</div>
                  )}
                </div>
                <CommentAttachments attachments={c.attachments} />
              </div>
            </div>
            );
          })}
          {comments.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("comments.none")}</p>
          ) : null}

          {emailReply && !composerOpen ? (
            <div className="mt-1 flex flex-wrap items-center gap-2 rounded-xl border bg-card p-2">
              <Button type="button" variant="secondary" size="sm" onClick={() => { setComposerOpen(true); setMode("reply"); }}>
                <Reply className="size-4" /> {t("comments.reply")}
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={() => { setComposerOpen(true); setMode("note"); }}>
                <Lock className="size-4" /> {t("comments.addNote")}
              </Button>
              {anchor ? (
                <ForwardMessageDialog ticketId={entityId} comment={{ id: anchor.id, author: anchor.author, bodyHtml: anchor.bodyHtml, body: anchor.body }} />
              ) : null}
            </div>
          ) : null}

          {composerMounted ? (
          <form
            ref={ref}
            action={async (fd) => {
              await addAction(fd);
              ref.current?.reset();
              editorRef.current?.setHTML("");
              setIsInternal(false);
              setMode("reply");
              setShowBcc(false);
              setQuoteAnchorId(null);
              setShowQuote(false);
              setComposerOpen(false);
              setResetKey((k) => k + 1);
            }}
            className={`mt-1 grid gap-2 rounded-xl border p-3 ${emailReply && mode === "note" ? "border-amber-500/30 bg-amber-500/5" : "bg-card"}`}
          >
            <input type="hidden" name={idField} value={entityId} />

            {emailReply ? (
              <>
                <div className="flex items-center gap-1 text-sm">
                  <button
                    type="button"
                    onClick={() => setMode("reply")}
                    className={`rounded-md px-2.5 py-1 font-medium transition-colors ${mode === "reply" ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground"}`}
                  >
                    {t("comments.reply")}
                  </button>
                  <button
                    type="button"
                    onClick={() => setMode("note")}
                    className={`rounded-md px-2.5 py-1 font-medium transition-colors ${mode === "note" ? "bg-amber-500/15 text-amber-700 dark:text-amber-400" : "text-muted-foreground hover:text-foreground"}`}
                  >
                    {t("comments.internalNote")}
                  </button>
                </div>
                <input type="hidden" name="isInternal" value={mode === "note" ? "on" : ""} />
                <input type="hidden" name="quoteFromCommentId" value={mode === "reply" ? anchorId ?? "" : ""} />
                {mode === "reply" ? (
                  <div key={resetKey} className="grid gap-1.5 rounded-lg border bg-background/60 p-2">
                    <RecipientField name="toRecipients" label={t("comments.to")} users={emailReply.candidateUsers} defaultEmails={emailReply.requesterEmail ? [emailReply.requesterEmail] : []} />
                    <RecipientField name="ccRecipients" label="Cc" users={emailReply.candidateUsers} defaultEmails={emailReply.participantEmails ?? []} />
                    {showBcc ? (
                      <RecipientField name="bccRecipients" label="Bcc" users={emailReply.candidateUsers} />
                    ) : (
                      <button type="button" onClick={() => setShowBcc(true)} className="w-fit pl-11 text-left text-xs text-muted-foreground hover:text-foreground">
                        + Bcc
                      </button>
                    )}
                  </div>
                ) : null}
              </>
            ) : null}

            <RichTextEditor
              name="bodyHtml"
              required
              placeholder={emailReply && mode === "note" ? t("comments.notePlaceholder") : placeholder}
              ariaLabel={t("comments.reply")}
              mentionUsers={mentionUsers}
              onReady={(handle) => { editorRef.current = handle; }}
              innerActions={aiTicketId ? <AiComposerButtons ticketId={aiTicketId} editorRef={editorRef} teaser={aiTeaser} /> : null}
            />

            {emailReply && mode === "reply" && quotedTrail.length > 0 ? (
              <div className="grid gap-1.5">
                <button
                  type="button"
                  onClick={() => setShowQuote((s) => !s)}
                  className="flex w-fit items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs text-muted-foreground hover:bg-muted"
                  title={showQuote ? t("comments.hideHistory") : t("comments.showHistory")}
                >
                  <MoreHorizontal className="size-4" />
                  {showQuote ? t("comments.hideHistory") : t("comments.historyCount", { count: quotedTrail.length })}
                </button>
                {showQuote ? (
                  <div className="max-h-72 divide-y divide-border overflow-auto rounded-lg border bg-muted/20">
                    {quotedTrail.map((m) => (
                      <div key={m.id} className="p-2.5">
                        <div className="text-xs text-muted-foreground">
                          {t.rich("comments.quoteHeader", {
                            date: f.date(m.createdAt, "dateTime"),
                            author: <span className="font-medium text-foreground/80">{m.author}</span>,
                          })}
                        </div>
                        {m.bodyHtml ? (
                          <div
                            className="prose prose-sm dark:prose-invert mt-1 max-w-none wrap-anywhere prose-pre:overflow-x-auto prose-table:block prose-table:overflow-x-auto text-muted-foreground"
                            dangerouslySetInnerHTML={{ __html: sanitizeCommentHtml(m.bodyHtml) }}
                          />
                        ) : (
                          <div className="mt-1 whitespace-pre-wrap text-muted-foreground">{m.body}</div>
                        )}
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}

            <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-2">
              <div className="flex flex-wrap items-center gap-2">
                {!emailReply && allowInternal ? (
                  <div className="flex items-center gap-2">
                    <Checkbox
                      id={`internal-${entityId}`}
                      name="isInternal"
                      checked={isInternal}
                      onCheckedChange={(v) => setIsInternal(v === true)}
                    />
                    <Label htmlFor={`internal-${entityId}`} className="text-xs text-muted-foreground">
                      {t("comments.internalNote")}
                    </Label>
                  </div>
                ) : null}
                {attachTarget ? <ComposerAttachments ticketId={attachTarget.ticketId} layout="inline" maxMb={maxMb} /> : null}
                {composerExtra ? <span className="contents">{composerExtra}</span> : null}
              </div>
              <div className="flex items-center gap-2">
                {emailReply ? (
                  <Button type="button" variant="ghost" size="sm" onClick={() => { setComposerOpen(false); setShowQuote(false); }}>
                    {tc("cancel")}
                  </Button>
                ) : null}
                <SubmitButton label={emailReply && mode === "note" ? t("comments.saveNote") : t("comments.send")} />
              </div>
            </div>
          </form>
          ) : null}
        </div>
      </TabsContent>

      {activity ? (
      <TabsContent value="activity" className="mt-4">
        <div className="grid gap-3">
          {activity.map((a) => (
            <div key={a.id} className="flex items-center gap-3 text-xs text-muted-foreground">
              <span className="grid size-6 shrink-0 place-items-center rounded-full border bg-muted">
                <ActivityIcon className="size-3" />
              </span>
              <span>
                <span className="font-medium text-foreground">{a.who}</span> {lowerLead(a.summary)} · <LocalTime date={a.createdAt} render={timeAgo} />
              </span>
            </div>
          ))}
          {activity.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("comments.noActivity")}</p>
          ) : null}
        </div>
      </TabsContent>
      ) : null}
    </Tabs>
  );
}
