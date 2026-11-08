import Link from "next/link";
import { CalendarCheck, Snowflake, TriangleAlert } from "lucide-react";
import { db } from "@/lib/db";
import { requireAgentUser } from "@/lib/session";
import { CHANGE_STATUS_META, changeRef } from "@/lib/constants";
import { isSchedulable, type FreezeWindow, type ScheduleConflict } from "@/lib/change-schedule-rules";
import { loadChangeScheduleCheck, type ChangeScheduleCheck } from "@/lib/change-schedule";
import { StatusBadge } from "@/components/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getFormatter, getT } from "@/lib/i18n/server";
import type { Formatter } from "@/lib/i18n/format";
import type { Translator } from "@/lib/i18n/translate";

type I18n = { t: Translator<"changes">; f: Formatter };

export type ChangeConflictsProps = {
  changeId: number;
  /** "banner": compact warning above the tabs; "panel": full list on the Planning tab. */
  variant: "banner" | "panel";
};

const windowText = (start: Date, end: Date, f: Formatter) => `${f.date(start, "dateTime")} – ${f.date(end, "dateTime")}`;

/** A freeze with its window in the viewer's locale (localized counterpart of describeFreeze). */
const freezeText = (freeze: Pick<FreezeWindow, "name" | "startsAt" | "endsAt">, f: Formatter) =>
  `${freeze.name} (${windowText(freeze.startsAt, freeze.endsAt, f)})`;

/** Schedule conflicts and freeze-window hits of a change (warnings only; freezes are enforced on save/submit). */
export async function ChangeConflicts({ changeId, variant }: ChangeConflictsProps) {
  const me = await requireAgentUser();
  if (!me) return null;

  const check = await loadChangeScheduleCheck(changeId);
  if (check && !isSchedulable(check.change.status)) return null;

  const [t, f] = await Promise.all([getT("changes"), getFormatter()]);
  const i18n: I18n = { t, f };
  if (variant === "banner") return check ? <ConflictBanner check={check} i18n={i18n} /> : null;
  return <ConflictPanel check={check} i18n={i18n} />;
}

function ConflictBanner({ check, i18n: { t } }: { check: ChangeScheduleCheck; i18n: I18n }) {
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
          {t("conflicts.inFreeze", { freezes: freezeHits.map((fr) => fr.name).join(", ") })}
        </span>
      ) : null}
      {conflicts.length > 0 ? (
        <span className="inline-flex flex-wrap items-center gap-x-1.5 text-amber-700 dark:text-amber-400">
          <TriangleAlert className="size-4" aria-hidden />
          {t.rich("conflicts.overlapsWith", {
            refs: (
              <>
                {conflicts.map(({ other }) => (
                  <Link key={other.id} href={`/changes/${other.id}`} className="font-mono underline-offset-2 hover:underline">
                    {changeRef(other.id)}
                  </Link>
                ))}
              </>
            ),
          })}
        </span>
      ) : null}
    </div>
  );
}

async function ConflictPanel({ check, i18n }: { check: ChangeScheduleCheck | null; i18n: I18n }) {
  const { t, f } = i18n;
  if (!check) {
    return (
      <PanelShell t={t}>
        <p className="text-sm text-muted-foreground">{t("conflicts.noWindow")}</p>
      </PanelShell>
    );
  }

  const { conflicts, freezeHits } = check;
  if (conflicts.length === 0 && freezeHits.length === 0) {
    return (
      <PanelShell t={t}>
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <CalendarCheck className="size-4 text-emerald-500" aria-hidden />
          {t("conflicts.none")}
        </p>
      </PanelShell>
    );
  }

  const names = await sharedNames(conflicts.map((c) => c.conflict));
  return (
    <PanelShell t={t}>
      <div className="grid gap-4">
        {freezeHits.length > 0 ? (
          <section className="grid gap-1.5">
            <h4 className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              <Snowflake className="size-3.5" aria-hidden /> {t("conflicts.freeze")}
            </h4>
            <ul className="grid gap-1 text-sm">
              {freezeHits.map((freeze) => (
                <li key={freeze.id}>
                  <span className="font-medium">{freezeText(freeze, f)}</span>
                  {freeze.reason ? <span className="text-muted-foreground"> · {freeze.reason}</span> : null}
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        {conflicts.length > 0 ? (
          <section className="grid gap-1.5">
            <h4 className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              <TriangleAlert className="size-3.5" aria-hidden /> {t("conflicts.overlapping")}
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
                  <p className="text-xs text-muted-foreground">{windowText(other.plannedStart, other.plannedEnd, f)}</p>
                  <p className="text-xs text-muted-foreground">{sharedSummary(conflict, names, t)}</p>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </PanelShell>
  );
}

function PanelShell({ children, t }: { children: React.ReactNode; t: Translator<"changes"> }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">{t("conflicts.title")}</CardTitle>
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

function sharedSummary(conflict: ScheduleConflict, names: SharedNames, t: Translator<"changes">): string {
  const parts: string[] = [];
  if (conflict.sharedAssetIds.length > 0) {
    parts.push(t("conflicts.sharedCi", { names: conflict.sharedAssetIds.map((id) => names.assets.get(id) ?? id).join(", ") }));
  }
  if (conflict.sharedServiceIds.length > 0) {
    parts.push(t("conflicts.sharedService", { names: conflict.sharedServiceIds.map((id) => names.services.get(id) ?? id).join(", ") }));
  }
  return parts.join(" · ");
}
