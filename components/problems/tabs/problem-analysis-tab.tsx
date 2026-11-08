import { Search, ShieldCheck } from "lucide-react";
import { ProblemTextCard } from "@/components/problems/problem-editors";
import { getT } from "@/lib/i18n/server";

export async function ProblemAnalysisTab({
  problemId,
  rootCause,
  workaround,
  editable,
}: {
  problemId: number;
  rootCause: string | null;
  workaround: string | null;
  editable: boolean;
}) {
  const t = await getT("problems");
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-2">
      <ProblemTextCard
        id={problemId}
        field="rootCause"
        label={t("rootCause")}
        icon={<Search className="size-4 text-muted-foreground" />}
        value={rootCause}
        emptyText={t("rootCauseEmpty")}
        editable={editable}
      />
      <ProblemTextCard
        id={problemId}
        field="workaround"
        label={t("workaround")}
        icon={<ShieldCheck className="size-4 text-muted-foreground" />}
        value={workaround}
        emptyText={t("workaroundEmpty")}
        editable={editable}
      />
    </div>
  );
}
