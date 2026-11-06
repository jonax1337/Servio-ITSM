import { format } from "date-fns";
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

export const metadata: Metadata = { title: "Change freeze windows" };
export const dynamic = "force-dynamic";

const STATE_META: Record<FreezeState, Meta> = {
  active: { label: "Active", tone: "danger" },
  upcoming: { label: "Upcoming", tone: "info" },
  past: { label: "Past", tone: "neutral" },
};

const DISPLAY_DATE = "PP p";

export default async function ChangeFreezePage() {
  await requireRole("MANAGER");
  const [freezes, services, teams] = await Promise.all([
    db.changeFreezeWindow.findMany({
      include: { service: { select: { name: true } }, group: { select: { name: true } } },
      orderBy: { startsAt: "desc" },
    }),
    db.service.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
    db.group.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  const serviceOptions = services.map((s) => ({ value: s.id, label: s.name }));
  const teamOptions = teams.map((t) => ({ value: t.id, label: t.name }));
  const now = new Date();

  return (
    <>
      <PageHeader
        icon={Snowflake}
        title="Change freeze windows"
        description="Periods in which planned changes are held back. Emergency changes may override a freeze with a justification."
      >
        <LinkButton href="/changes/calendar" variant="outline">
          <CalendarRange className="size-4" /> Change calendar
        </LinkButton>
        <FreezeWindowDialog services={serviceOptions} teams={teamOptions} />
      </PageHeader>

      <PageBody>
        {freezes.length === 0 ? (
          <EmptyState
            icon={Snowflake}
            title="No freeze windows"
            description="Create one to hold back changes during year-end, audits or other sensitive periods."
          />
        ) : (
          <div className="overflow-hidden rounded-xl border bg-card">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Name</TableHead>
                  <TableHead>State</TableHead>
                  <TableHead>Window</TableHead>
                  <TableHead className="hidden md:table-cell">Applies to</TableHead>
                  <TableHead className="w-[1%]"><span className="sr-only">Actions</span></TableHead>
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
                      <ToneBadge meta={STATE_META[state]} dot />
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground tabular-nums">
                      {format(freeze.startsAt, DISPLAY_DATE)} – {format(freeze.endsAt, DISPLAY_DATE)}
                    </TableCell>
                    <TableCell className="hidden text-sm text-muted-foreground md:table-cell">
                      {[freeze.service?.name, freeze.group?.name].filter(Boolean).join(" · ") || "All changes"}
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
