import { Search, ShieldCheck } from "lucide-react";
import { ProblemTextCard } from "@/components/problems/problem-editors";

export function ProblemAnalysisTab({
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
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <ProblemTextCard
        id={problemId}
        field="rootCause"
        label="Root cause"
        icon={<Search className="size-4 text-muted-foreground" />}
        value={rootCause}
        emptyText="Not yet identified."
        editable={editable}
      />
      <ProblemTextCard
        id={problemId}
        field="workaround"
        label="Workaround"
        icon={<ShieldCheck className="size-4 text-muted-foreground" />}
        value={workaround}
        emptyText="No workaround documented."
        editable={editable}
      />
    </div>
  );
}
