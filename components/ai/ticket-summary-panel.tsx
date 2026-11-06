"use client";

import { useState, useTransition } from "react";
import { ChevronDown, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { SableMark } from "@/components/sable-mark";
import { summarizeThread } from "@/lib/actions/ai";
import { AI_TEASER_MESSAGE } from "@/lib/constants";

type Summary = { status: "idle" } | { status: "ready"; html: string } | { status: "failed"; error: string };

/** The client half of TicketSummaryCard: opens on click, loads the summary once, refreshes on request. */
export function TicketSummaryPanel({ ticketId, teaser }: { ticketId: number; teaser: boolean }) {
  const [open, setOpen] = useState(false);
  const [summary, setSummary] = useState<Summary>({ status: "idle" });
  const [pending, startTransition] = useTransition();

  function load() {
    startTransition(async () => {
      const result = await summarizeThread(ticketId);
      setSummary(result.ok ? { status: "ready", html: result.html } : { status: "failed", error: result.error });
    });
  }

  function toggle() {
    if (teaser) return void toast.info(AI_TEASER_MESSAGE);
    const opening = !open;
    setOpen(opening);
    if (opening && summary.status !== "ready" && !pending) load();
  }

  return (
    <section className="rounded-xl border border-sable/25 bg-sable-muted/40">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className="flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left text-sm font-medium focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        <SableMark className="size-4" />
        <span className="flex-1">Thread summary</span>
        <ChevronDown className={`size-4 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open ? (
        <div className="border-t border-sable/25 px-3 py-3">
          {pending ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Reading the ticket…
            </div>
          ) : summary.status === "ready" ? (
            <>
              <div
                className="prose prose-sm max-w-none dark:prose-invert prose-p:my-1.5 prose-ul:my-1.5 prose-li:my-0.5"
                dangerouslySetInnerHTML={{ __html: summary.html }}
              />
              <div className="mt-2.5 flex justify-end">
                <Button type="button" variant="ghost" size="sm" onClick={load}>
                  <RefreshCw className="size-3.5" /> Refresh
                </Button>
              </div>
            </>
          ) : summary.status === "failed" ? (
            <div className="flex items-center justify-between gap-3 text-sm">
              <span className="text-destructive">{summary.error}</span>
              <Button type="button" variant="outline" size="sm" onClick={load}>
                Try again
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
