import Link from "next/link";
import { CircleCheck, TriangleAlert } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { blockerMessage, type ReleaseReadiness } from "@/lib/release-rules";
import { changeRef } from "@/lib/constants";

/** Whether every bundled change has cleared approval, and what still blocks the release. */
export function ReleaseReadinessCard({ readiness }: { readiness: ReleaseReadiness }) {
  const { ready, summary, blockers, active, approved } = readiness;
  const percent = active === 0 ? 0 : Math.round((approved / active) * 100);
  const Icon = ready ? CircleCheck : TriangleAlert;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <Icon className={ready ? "size-4 text-emerald-600 dark:text-emerald-400" : "size-4 text-amber-600 dark:text-amber-400"} />
          Readiness
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3">
        <p className="text-sm">{summary}</p>
        <div
          role="progressbar"
          aria-label="Approved changes"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
          className="h-1.5 overflow-hidden rounded-full bg-muted"
        >
          <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${percent}%` }} />
        </div>
        {blockers.length > 0 ? (
          <ul className="grid gap-1.5 text-sm">
            {blockers.map((blocker) => (
              <li key={blocker.changeId} className="flex flex-wrap items-baseline gap-x-2">
                <Link href={`/changes/${blocker.changeId}`} className="font-mono text-xs text-primary hover:underline">
                  {changeRef(blocker.changeId)}
                </Link>
                <span className="text-muted-foreground">{blockerMessage(blocker)}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </CardContent>
    </Card>
  );
}
