"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { BookPlus, FolderPlus, Loader2, Siren, X } from "lucide-react";
import { toast } from "sonner";
import { createProblemFromInsight, dismissAiInsight, draftArticleFromInsight } from "@/lib/actions/ai-insights";
import { Button } from "@/components/ui/button";
import { LinkButton } from "@/components/link-button";

type InsightActionsProps = {
  insightId: string;
  kind: "CLUSTER" | "KB_GAP";
  /** The cluster's first ticket: its page carries the "Declare major incident" toggle. */
  majorIncidentTicket?: { id: number; ref: string };
};

export function InsightActions({ insightId, kind, majorIncidentTicket }: InsightActionsProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const formData = () => {
    const fd = new FormData();
    fd.set("insightId", insightId);
    return fd;
  };

  const createProblem = () =>
    startTransition(async () => {
      const result = await createProblemFromInsight(formData());
      if (!result.ok) return void toast.error(result.error);
      toast.success(
        result.skipped > 0
          ? `Problem created. ${result.linked} tickets linked, ${result.skipped} left out.`
          : `Problem created and ${result.linked} tickets linked.`,
      );
      router.push(`/problems/${result.problemId}`);
    });

  const draftArticle = () =>
    startTransition(async () => {
      const result = await draftArticleFromInsight(formData());
      if (!result.ok) return void toast.error(result.error);
      toast.success(result.aiDrafted ? "Draft article written." : "Draft article created from the resolutions.");
      router.push(`/knowledge/${result.slug}`);
    });

  const dismiss = () =>
    startTransition(async () => {
      const result = await dismissAiInsight(formData());
      if (!result.ok) return void toast.error(result.error);
      toast.success("Insight dismissed.");
      router.refresh();
    });

  const busy = pending ? <Loader2 className="animate-spin" /> : null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {kind === "CLUSTER" ? (
        <>
          <Button type="button" size="sm" onClick={createProblem} disabled={pending}>
            {busy ?? <FolderPlus />}
            Create problem &amp; link tickets
          </Button>
          {majorIncidentTicket ? (
            <LinkButton
              href={`/tickets/${majorIncidentTicket.id}`}
              variant="outline"
              size="sm"
              title={`Opens ${majorIncidentTicket.ref}; declare the major incident from its Actions menu`}
            >
              <Siren />
              Declare major incident
            </LinkButton>
          ) : null}
        </>
      ) : (
        <Button type="button" size="sm" onClick={draftArticle} disabled={pending}>
          {busy ?? <BookPlus />}
          Draft article
        </Button>
      )}
      <Button type="button" variant="ghost" size="sm" onClick={dismiss} disabled={pending}>
        <X />
        Dismiss
      </Button>
    </div>
  );
}
