"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { BookPlus, FolderPlus, Loader2, Siren, X } from "lucide-react";
import { toast } from "sonner";
import { createProblemFromInsight, dismissAiInsight, draftArticleFromInsight } from "@/lib/actions/ai-insights";
import { Button } from "@/components/ui/button";
import { LinkButton } from "@/components/link-button";
import { useServerMessage, useT } from "@/lib/i18n/client";

type InsightActionsProps = {
  insightId: string;
  kind: "CLUSTER" | "KB_GAP";
  /** The cluster's first ticket: its page carries the "Declare major incident" toggle. */
  majorIncidentTicket?: { id: number; ref: string };
};

export function InsightActions({ insightId, kind, majorIncidentTicket }: InsightActionsProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const t = useT("assistant");
  const tm = useServerMessage();

  const formData = () => {
    const fd = new FormData();
    fd.set("insightId", insightId);
    return fd;
  };

  const createProblem = () =>
    startTransition(async () => {
      const result = await createProblemFromInsight(formData());
      if (!result.ok) return void toast.error(tm(result.error));
      toast.success(
        result.skipped > 0
          ? t("insight.problemCreatedSkipped", { linked: result.linked, skipped: result.skipped })
          : t("insight.problemCreated", { linked: result.linked }),
      );
      router.push(`/problems/${result.problemId}`);
    });

  const draftArticle = () =>
    startTransition(async () => {
      const result = await draftArticleFromInsight(formData());
      if (!result.ok) return void toast.error(tm(result.error));
      toast.success(result.aiDrafted ? t("insight.articleWritten") : t("insight.articleFromResolutions"));
      router.push(`/knowledge/${result.slug}`);
    });

  const dismiss = () =>
    startTransition(async () => {
      const result = await dismissAiInsight(formData());
      if (!result.ok) return void toast.error(tm(result.error));
      toast.success(t("insight.dismissed"));
      router.refresh();
    });

  const busy = pending ? <Loader2 className="animate-spin" /> : null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {kind === "CLUSTER" ? (
        <>
          <Button type="button" size="sm" onClick={createProblem} disabled={pending}>
            {busy ?? <FolderPlus />}
            {t("insight.createProblem")}
          </Button>
          {majorIncidentTicket ? (
            <LinkButton
              href={`/tickets/${majorIncidentTicket.id}`}
              variant="outline"
              size="sm"
              title={t("insight.declareMajorTitle", { ref: majorIncidentTicket.ref })}
            >
              <Siren />
              {t("insight.declareMajor")}
            </LinkButton>
          ) : null}
        </>
      ) : (
        <Button type="button" size="sm" onClick={draftArticle} disabled={pending}>
          {busy ?? <BookPlus />}
          {t("insight.draftArticle")}
        </Button>
      )}
      <Button type="button" variant="ghost" size="sm" onClick={dismiss} disabled={pending}>
        <X />
        {t("insight.dismiss")}
      </Button>
    </div>
  );
}
