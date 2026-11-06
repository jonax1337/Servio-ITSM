import Link from "next/link";
import { format } from "date-fns";
import { CalendarCheck, Snowflake, TriangleAlert } from "lucide-react";
import { db } from "@/lib/db";
import { requireAgentUser } from "@/lib/session";
import { CHANGE_STATUS_META, changeRef } from "@/lib/constants";
import { describeFreeze, isSchedulable, type ScheduleConflict } from "@/lib/change-schedule-rules";
import { loadChangeScheduleCheck, type ChangeScheduleCheck } from "@/lib/change-schedule";
import { StatusBadge } from "@/components/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export type ChangeConflictsProps = {
  changeId: number;
  /** "banner": compact warning above the tabs; "panel": full list on the Planning tab. */
  variant: "banner" | "panel";
};

const WINDOW_FORMAT = "PP p";

const windowText = (start: Date, end: Date) => `${format(start, WINDOW_FORMAT)} – ${format(end, WINDOW_FORMAT)}`;

/** Schedule conflicts and freeze-window hits of a change (warnings only; freezes are enforced on save/submit). */
export async function ChangeConflicts({ changeId, variant }: ChangeConflictsProps) {
  const me = await requireAgentUser();
  if (!me) return null;

  const check = await loadChangeScheduleCheck(changeId);
  if (check && !isSchedulable(check.change.status)) return null;

  if (variant === "banner") return check ? <ConflictBanner check={check} /> : null;
  return <ConflictPanel check={check} />;
}

function ConflictBanner({ check }: { check: ChangeScheduleCheck }) {
  const { conflicts, freezeHits } = check;
  if (conflicts.length === 0 && freezeHits.length === 0) return null;

  return (
    <div
      role="status"
      className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b bg-amber-500/5 px-4 py-2 text-sm sm:px-6"
    >
      {freezeHits.length > 0 ? (
        <span className="inline-flex items-center gap-1.5 text-amber-700 dark:text-amber-400">
          <Snowflake className="size-4" aria-hidden />
          Planned window falls inside a change freeze: {freezeHits.map((f) => f.name).join(", ")}
        </span>
      ) : null}
      {conflicts.length > 0 ? (
        <span className="inline-flex flex-wrap items-center gap-x-1.5 text-amber-700 dark:text-amber-400">
          <TriangleAlert className="size-4" aria-hidden />
          Overlaps with
          {conflicts.map(({ other }) => (
            <Link key={other.id} href={`/changes/${other.id}`} className="font-mono underline-offset-2 hover:underline">
              {changeRef(other.id)}
            </Link>
          ))}
          on shared configuration items or services
        </span>
      ) : null}
    </div>
  );
}

async function ConflictPanel({ check }: { check: ChangeScheduleCheck | null }) {
  if (!check) {
    return (
      <PanelShell>
        <p className="text-sm text-muted-foreground">Set a planned window to check for schedule conflicts and change freezes.</p>
      </PanelShell>
    );
  }

  const { conflicts, freezeHits } = check;
  if (conflicts.length === 0 && freezeHits.length === 0) {
    return (
      <PanelShell>
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <CalendarCheck className="size-4 text-emerald-500" aria-hidden />
          No conflicting changes and no change freeze in this window.
        </p>
      </PanelShell>
    );
  }

  const names = await sharedNames(conflicts.map((c) => c.conflict));
  return (
    <PanelShell>
      <div className="grid gap-4">
        {freezeHits.length > 0 ? (
          <section className="grid gap-1.5">
            <h4 className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              <Snowflake className="size-3.5" aria-hidden /> Change freeze
            </h4>
            <ul className="grid gap-1 text-sm">
              {freezeHits.map((freeze) => (
                <li key={freeze.id}>
                  <span className="font-medium">{describeFreeze(freeze)}</span>
                  {freeze.reason ? <span className="text-muted-foreground"> · {freeze.reason}</span> : null}
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        {conflicts.length > 0 ? (
          <section className="grid gap-1.5">
            <h4 className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              <TriangleAlert className="size-3.5" aria-hidden /> Overlapping changes
            </h4>
            <ul className="grid gap-2">
              {conflicts.map(({ conflict, other }) => (
                <li key={other.id} className="grid gap-0.5 rounded-lg border p-2.5 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link href={`/changes/${other.id}`} className="font-medium hover:text-primary">
                      <span className="font-mono text-xs text-muted-foreground">{changeRef(other.id)}</span> {other.title}
                    </Link>
                    <StatusBadge map={CHANGE_STATUS_META} value={other.status} />
                  </div>
                  <p className="text-xs text-muted-foreground">{windowText(other.plannedStart, other.plannedEnd)}</p>
                  <p className="text-xs text-muted-foreground">{sharedSummary(conflict, names)}</p>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </PanelShell>
  );
}

function PanelShell({ children }: { children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Schedule check</CardTitle>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

type SharedNames = { assets: Map<string, string>; services: Map<string, string> };

/** Names of the CIs and services behind the conflicts, so the panel can say what is shared. */
async function sharedNames(conflicts: ScheduleConflict[]): Promise<SharedNames> {
  const assetIds = [...new Set(conflicts.flatMap((c) => c.sharedAssetIds))];
  const serviceIds = [...new Set(conflicts.flatMap((c) => c.sharedServiceIds))];
  const [assets, services] = await Promise.all([
    db.asset.findMany({ where: { id: { in: assetIds } }, select: { id: true, name: true } }),
    db.service.findMany({ where: { id: { in: serviceIds } }, select: { id: true, name: true } }),
  ]);
  return {
    assets: new Map(assets.map((a) => [a.id, a.name])),
    services: new Map(services.map((s) => [s.id, s.name])),
  };
}

function sharedSummary(conflict: ScheduleConflict, names: SharedNames): string {
  const parts: string[] = [];
  if (conflict.sharedAssetIds.length > 0) {
    parts.push(`Shared CI: ${conflict.sharedAssetIds.map((id) => names.assets.get(id) ?? id).join(", ")}`);
  }
  if (conflict.sharedServiceIds.length > 0) {
    parts.push(`Shared service: ${conflict.sharedServiceIds.map((id) => names.services.get(id) ?? id).join(", ")}`);
  }
  return parts.join(" · ");
}
