import { sanitizeCommentHtml } from "@/lib/markdown";
import { ProblemAnalysisTab } from "@/components/problems/tabs/problem-analysis-tab";
import { getT } from "@/lib/i18n/server";

/** Overview tab: the description, then the analysis (root cause and workaround) that goes with it. */
export async function ProblemOverviewTab({
  problemId,
  description,
  descriptionHtml,
  rootCause,
  workaround,
  editable,
}: {
  problemId: number;
  description: string | null;
  descriptionHtml: string | null;
  rootCause: string | null;
  workaround: string | null;
  editable: boolean;
}) {
  const t = await getT("problems");
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
      <div className="rounded-xl border bg-card p-4 text-sm leading-relaxed">
        {descriptionHtml ? (
          <div className="prose prose-sm dark:prose-invert max-w-none wrap-anywhere prose-pre:overflow-x-auto prose-table:block prose-table:overflow-x-auto" dangerouslySetInnerHTML={{ __html: sanitizeCommentHtml(descriptionHtml) }} />
        ) : description ? (
          <div className="whitespace-pre-wrap wrap-anywhere">{description}</div>
        ) : (
          <span className="text-muted-foreground">{t("noDescription")}</span>
        )}
      </div>
      <ProblemAnalysisTab problemId={problemId} rootCause={rootCause} workaround={workaround} editable={editable} />
    </div>
  );
}
