import Link from "next/link";
import type { Metadata } from "next";
import { PhoneCall, Plus, Users } from "lucide-react";
import { requireRole, hasRole } from "@/lib/session";
import { loadSchedules, onCallPersonAt, toScheduleInput, type LoadedSchedule, type OnCallPerson } from "@/lib/oncall";
import { buildTimeline } from "@/lib/oncall-rules";
import { ONCALL_ROTATION_META, type OnCallRotationType } from "@/lib/constants";
import { getParam, type SearchParams } from "@/lib/query";
import { PageHeader, PageBody } from "@/components/page-header";
import { LinkButton } from "@/components/link-button";
import { ListToolbar, type FilterDef } from "@/components/list-toolbar";
import { EmptyState } from "@/components/empty-state";
import { ToneBadge } from "@/components/status-badge";
import { UserAvatar } from "@/components/user-avatar";
import { activityMeta, cadenceLabel, formatInZone } from "@/components/oncall/format";
import { getT } from "@/lib/i18n/server";
import { INTL_LOCALE } from "@/lib/i18n/config";
import type { Translator } from "@/lib/i18n/translate";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT("oncall");
  return { title: t("title") };
}
export const dynamic = "force-dynamic";

const LOOKAHEAD_MS = 14 * 24 * 3_600_000;

type Shift = {
  holder: OnCallPerson | null;
  until: Date;
  /** Who takes over at `until`, when known. */
  next: OnCallPerson | null;
};

/** Who holds the schedule right now, until when, and who follows (a null holder = gap). */
function shiftOf(schedule: LoadedSchedule, now: Date, horizon: Date): Shift {
  const [current, following] = buildTimeline(toScheduleInput(schedule), now, horizon);
  const people = [...schedule.members, ...schedule.overrides.map((o) => o.user)];
  const next = people.find((p) => p.id === following?.userId) ?? null;
  return { holder: onCallPersonAt(schedule, now), until: current?.end ?? horizon, next };
}

function Holder({ shift, timezone, t }: { shift: Shift; timezone: string; t: Translator<"oncall"> }) {
  if (!shift.holder) return <span className="text-sm font-medium text-destructive">{t("nobodyOnCall")}</span>;
  return (
    <div className="flex min-w-0 items-center gap-2">
      <UserAvatar name={shift.holder.name} email={shift.holder.email} size="sm" />
      <div className="min-w-0">
        <div className="truncate text-sm font-medium">{shift.holder.name ?? shift.holder.email}</div>
        <div className="truncate text-xs text-muted-foreground">
          {t("until", { date: formatInZone(shift.until, timezone, INTL_LOCALE[t.locale]) })}
          {shift.next ? t("thenNext", { name: shift.next.name ?? shift.next.email }) : ""}
        </div>
      </div>
    </div>
  );
}

function matches(schedule: LoadedSchedule, q: string | undefined, team: string | undefined, state: string | undefined) {
  if (team && team !== "all" && schedule.group.id !== team) return false;
  if (state === "active" && !schedule.isActive) return false;
  if (state === "inactive" && schedule.isActive) return false;
  if (!q) return true;
  const needle = q.toLowerCase();
  return [schedule.name, schedule.group.name, schedule.description ?? ""].some((text) => text.toLowerCase().includes(needle));
}

export default async function OnCallPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const me = await requireRole("AGENT");
  const [t, tc] = await Promise.all([getT("oncall"), getT("common")]);
  const canManage = hasRole(me.role, "MANAGER");
  const now = new Date();
  const horizon = new Date(now.getTime() + LOOKAHEAD_MS);
  const all = await loadSchedules({}, now, horizon);

  const q = getParam(sp, "q");
  const team = getParam(sp, "team");
  const state = getParam(sp, "state");
  const schedules = all.filter((s) => matches(s, q, team, state));
  const shifts = new Map(schedules.map((s) => [s.id, shiftOf(s, now, horizon)]));

  const teams = new Map(all.map((s) => [s.group.id, s.group.name]));
  const filters: FilterDef[] = [
    { key: "team", label: t("teams"), options: [...teams].map(([value, label]) => ({ value, label })) },
    { key: "state", label: tc("status"), options: [{ value: "active", label: tc("active") }, { value: "inactive", label: tc("inactive") }] },
  ];

  return (
    <>
      <PageHeader icon={PhoneCall} title={t("title")} description={t("description")}>
        {canManage ? (
          <LinkButton href="/oncall/new">
            <Plus className="size-4" /> {t("newSchedule")}
          </LinkButton>
        ) : null}
      </PageHeader>

      <PageBody className="grid gap-4">
        {all.length === 0 ? (
          <EmptyState
            icon={PhoneCall}
            title={t("emptyTitle")}
            description={canManage ? t("emptyManager") : t("emptyAgent")}
          >
            {canManage ? (
              <LinkButton href="/oncall/new" size="sm">
                <Plus className="size-4" /> {t("newSchedule")}
              </LinkButton>
            ) : null}
          </EmptyState>
        ) : (
          <>
            <ListToolbar filters={filters} searchPlaceholder={t("searchPlaceholder")} />

            {schedules.length === 0 ? (
              <EmptyState icon={PhoneCall} title={t("noneFoundTitle")} description={t("noneFoundDescription")} />
            ) : (
              <div className="overflow-hidden rounded-xl border bg-card">
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead>{t("colSchedule")}</TableHead>
                      <TableHead className="hidden sm:table-cell">{t("colTeam")}</TableHead>
                      <TableHead className="hidden lg:table-cell">{t("colRotation")}</TableHead>
                      <TableHead>{t("colOnCallNow")}</TableHead>
                      <TableHead className="hidden text-right md:table-cell">{t("colMembers")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {schedules.map((s) => (
                      <TableRow key={s.id} className="group">
                        <TableCell className="max-w-[280px]">
                          <Link href={`/oncall/${s.id}`} className="block">
                            <span className="flex items-center gap-2">
                              <span className="truncate font-medium group-hover:text-primary">{s.name}</span>
                              {s.isActive ? null : <ToneBadge meta={activityMeta(false, tc)} icon={false} />}
                            </span>
                            <span className="line-clamp-1 text-xs text-muted-foreground sm:hidden">{s.group.name}</span>
                          </Link>
                        </TableCell>
                        <TableCell className="hidden sm:table-cell">
                          <span className="inline-flex items-center gap-2 text-sm text-muted-foreground">
                            <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: s.group.color }} aria-hidden />
                            {s.group.name}
                          </span>
                        </TableCell>
                        <TableCell className="hidden lg:table-cell">
                          <span className="inline-flex items-center gap-2 text-sm">
                            <ToneBadge meta={ONCALL_ROTATION_META[s.rotationType as OnCallRotationType] ?? ONCALL_ROTATION_META.CUSTOM} icon={false} />
                            <span className="text-muted-foreground">{cadenceLabel(s.rotationType, s.customIntervalHours, t)} · {s.timezone}</span>
                          </span>
                        </TableCell>
                        <TableCell>
                          {s.isActive ? <Holder shift={shifts.get(s.id)!} timezone={s.timezone} t={t} /> : <span className="text-sm text-muted-foreground">—</span>}
                        </TableCell>
                        <TableCell className="hidden text-right tabular-nums md:table-cell">
                          <span className="inline-flex items-center gap-1.5"><Users className="size-3.5 text-muted-foreground" />{s.members.length}</span>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </>
        )}
      </PageBody>
    </>
  );
}
