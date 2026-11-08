import { CalendarRange, Snowflake } from "lucide-react";
import type { Metadata } from "next";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/session";
import { freezeState, type FreezeState } from "@/lib/change-schedule-rules";
import type { Meta } from "@/lib/constants";
import { PageBody, PageHeader } from "@/components/page-header";
import { LinkButton } from "@/components/link-button";
import { ToneBadge } from "@/components/status-badge";
import { EmptyState } from "@/components/empty-state";
import { FreezeWindowDialog } from "@/components/changes/calendar/freeze-window-dialog";
import { DeleteFreezeButton } from "@/components/changes/calendar/delete-freeze-button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getFormatter, getT } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT("changes");
  return { title: t("freeze.title") };
}
export const dynamic = "force-dynamic";

const STATE_TONES: Record<FreezeState, Meta["tone"]> = { active: "danger", upcoming: "info", past: "neutral" };

export default async function ChangeFreezePage() {
  await requireRole("MANAGER");
  const [t, tc, f] = await Promise.all([getT("changes"), getT("common"), getFormatter()]);
  const stateMeta = (state: FreezeState): Meta => ({ label: t(`freeze.state.${state}`), tone: STATE_TONES[state] });
  const [freezes, services, teams] = await Promise.all([
    db.changeFreezeWindow.findMany({
      include: { service: { select: { name: true } }, group: { select: { name: true } } },
      orderBy: { startsAt: "desc" },
    }),
    db.service.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
    db.group.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  const serviceOptions = services.map((s) => ({ value: s.id, label: s.name }));
  const teamOptions = teams.map((team) => ({ value: team.id, label: team.name }));
  const now = new Date();

  return (
    <>
      <PageHeader
        icon={Snowflake}
        title={t("freeze.title")}
        description={t("freeze.description")}
      >
        <LinkButton href="/changes/calendar" variant="outline">
          <CalendarRange className="size-4" /> {t("freeze.calendar")}
        </LinkButton>
        <FreezeWindowDialog services={serviceOptions} teams={teamOptions} />
      </PageHeader>

      <PageBody>
        {freezes.length === 0 ? (
          <EmptyState
            icon={Snowflake}
            title={t("freeze.emptyTitle")}
            description={t("freeze.emptyDescription")}
          />
        ) : (
          <div className="overflow-hidden rounded-xl border bg-card">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>{tc("name")}</TableHead>
                  <TableHead>{t("freeze.stateHead")}</TableHead>
                  <TableHead>{t("freeze.window")}</TableHead>
                  <TableHead className="hidden md:table-cell">{t("freeze.appliesTo")}</TableHead>
                  <TableHead className="w-[1%]"><span className="sr-only">{tc("actions")}</span></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {freezes.map((freeze) => {
                  const state = freezeState(freeze, now);
                  return (
                  <TableRow key={freeze.id} className={state === "past" ? "opacity-60" : undefined}>
                    <TableCell className="max-w-[320px]">
                      <span className="font-medium">{freeze.name}</span>
                      {freeze.reason ? <span className="block text-xs text-muted-foreground">{freeze.reason}</span> : null}
                    </TableCell>
                    <TableCell>
                      <ToneBadge meta={stateMeta(state)} dot />
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground tabular-nums">
                      {f.date(freeze.startsAt, "dateTime")} – {f.date(freeze.endsAt, "dateTime")}
                    </TableCell>
                    <TableCell className="hidden text-sm text-muted-foreground md:table-cell">
                      {[freeze.service?.name, freeze.group?.name].filter(Boolean).join(" · ") || t("freeze.allChanges")}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-1">
                        <FreezeWindowDialog freeze={freeze} services={serviceOptions} teams={teamOptions} />
                        <DeleteFreezeButton id={freeze.id} name={freeze.name} />
                      </div>
                    </TableCell>
                  </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </PageBody>
    </>
  );
}
