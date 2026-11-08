"use client";

import { useState } from "react";
import Link from "next/link";
import { AlertCircle, Send, MessageSquare, Check, Loader2, ArrowUpRight, Paperclip } from "lucide-react";
import type { ToolCallMessagePartComponent } from "@assistant-ui/react";
import { ToolFallback } from "@/components/tool-fallback";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ToolActivityChip, hasToolActivity } from "@/components/assistant/tool-activity";
import type { RequestProposal } from "@/lib/portal-assistant";
import { PRIORITY_META } from "@/lib/constants";
import { useEnumT, useServerMessage, useT } from "@/lib/i18n/client";

/**
 * Tool UI for the self-service (portal) assistant-ui thread: renders a
 * confirm-to-create card for the portal's propose_* drafts (ticket / catalog
 * order / reply), and falls back to the default tool display for read tools.
 */
type ProposalAttachment = { name: string; type: string; dataUrl: string };

export const PortalToolUI: ToolCallMessagePartComponent = (props) => {
  if (props.toolName.startsWith("propose_")) {
    const result = props.result as { proposal?: RequestProposal; attachments?: ProposalAttachment[] } | undefined;
    if (result?.proposal)
      return <PortalConfirmCard proposal={result.proposal} attachments={result.attachments ?? []} />;
    return null; // still running / unresolved — no generic card
  }
  if (hasToolActivity(props.toolName) && props.status?.type !== "incomplete") {
    return (
      <ToolActivityChip
        toolName={props.toolName}
        args={props.args as Record<string, unknown> | undefined}
        running={props.status?.type === "running"}
      />
    );
  }
  return <ToolFallback {...props} />;
};

function PortalConfirmCard({
  proposal,
  attachments,
}: {
  proposal: RequestProposal;
  attachments: ProposalAttachment[];
}) {
  const [state, setState] = useState<"idle" | "creating" | "done" | "error" | "dismissed">("idle");
  const [error, setError] = useState<string>("");
  const [created, setCreated] = useState<{ ref: string; url: string } | null>(null);
  const t = useT("portal");
  const te = useEnumT();
  const tm = useServerMessage();

  if (state === "dismissed") return null;

  async function confirm() {
    setState("creating");
    try {
      const res = await fetch("/api/portal/assistant/create", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...proposal, attachmentIds: [], attachments }),
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        setCreated({ ref: data.ref, url: data.url });
        setState("done");
      } else {
        setError(data.error ? tm(data.error) : t("createRequestFailed"));
        setState("error");
      }
    } catch {
      setError(t("serverUnreachable"));
      setState("error");
    }
  }

  const done = state === "done";
  const cta =
    proposal.kind === "service" ? t("submitRequest") : proposal.kind === "comment" ? t("postReply") : t("createRequest");

  return (
    <div
      className={cn(
        "my-1 w-full rounded-xl border bg-card p-3 text-sm shadow-sm",
        done && "border-emerald-500/30 bg-emerald-500/[0.04]",
      )}
    >
      {proposal.kind === "ticket" ? (
        <>
          <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
            {proposal.type === "INCIDENT" ? (
              <AlertCircle className="size-3.5 text-sable" />
            ) : (
              <Send className="size-3.5 text-sable" />
            )}
            {proposal.type === "INCIDENT" ? t("newIssue") : t("newRequest")} · {t("priorityLabel", { priority: te(PRIORITY_META, proposal.priority) })}
            {proposal.categoryName ? ` · ${proposal.categoryName}` : ""}
          </div>
          <p className="mt-1.5 font-medium">{proposal.title}</p>
          {proposal.description ? (
            <p className="mt-1 line-clamp-3 text-xs text-muted-foreground">{proposal.description}</p>
          ) : null}
        </>
      ) : proposal.kind === "comment" ? (
        <>
          <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
            <MessageSquare className="size-3.5 text-sable" /> {t("replyTo", { ref: proposal.ref })}
          </div>
          <p className="mt-1.5">{proposal.body}</p>
        </>
      ) : (
        <>
          <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
            <Send className="size-3.5 text-sable" /> {t("catalogRequest")}
            {proposal.requiresApproval ? ` · ${t("needsApprovalShort")}` : ""}
          </div>
          <p className="mt-1.5 font-medium">{proposal.itemName}</p>
          {proposal.answers.filter((a) => a.value).length > 0 ? (
            <dl className="mt-2 grid gap-1 rounded-lg bg-muted/50 p-2 text-xs">
              {proposal.answers
                .filter((a) => a.value)
                .map((a) => (
                  <div key={a.key} className="flex gap-2">
                    <dt className="shrink-0 text-muted-foreground">{a.label}</dt>
                    <dd className="min-w-0 flex-1 truncate font-medium">{a.value}</dd>
                  </div>
                ))}
            </dl>
          ) : null}
        </>
      )}

      {attachments.length > 0 && !done ? (
        <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
          <Paperclip className="size-3.5" />
          {t("attachmentsWillBeAdded", { count: attachments.length })}
        </p>
      ) : null}

      <div className="mt-2.5 flex items-center gap-2">
        {done && created ? (
          <Link
            href={created.url}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-600 hover:underline dark:text-emerald-400"
          >
            <Check className="size-3.5" /> {proposal.kind === "comment" ? t("repliedTo", { ref: created.ref }) : t("created", { ref: created.ref })}
            <ArrowUpRight className="size-3.5" />
          </Link>
        ) : (
          <>
            <Button
              type="button"
              size="sm"
              onClick={confirm}
              disabled={state === "creating"}
              className="h-7 gap-1.5 bg-sable px-3 text-sable-foreground hover:bg-sable/90"
            >
              {state === "creating" ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
              {cta}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-7 px-3 text-muted-foreground"
              disabled={state === "creating"}
              onClick={() => setState("dismissed")}
            >
              {t("notNow")}
            </Button>
          </>
        )}
      </div>

      {state === "error" && error ? (
        <p className="mt-2 flex items-start gap-1.5 rounded-lg bg-destructive/10 px-2 py-1.5 text-xs text-destructive">
          <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
          <span className="min-w-0">{error}</span>
        </p>
      ) : null}
    </div>
  );
}
