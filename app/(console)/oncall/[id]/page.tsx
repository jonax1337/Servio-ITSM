import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { ArrowLeft, CalendarClock, Trash2 } from "lucide-react";
import { db } from "@/lib/db";
import { requireRole, hasRole } from "@/lib/session";
import { getFormOptions } from "@/lib/data/options";
import { loadSchedules, onCallPersonAt, toScheduleInput, type LoadedSchedule } from "@/lib/oncall";
import { buildTimeline, canRemoveOverride, localDate, type TimelineSegment } from "@/lib/oncall-rules";
import { ONCALL_ROTATION_META, type OnCallRotationType } from "@/lib/constants";
import { deleteOverride, deleteSchedule, setScheduleActive } from "@/lib/actions/oncall";
import { LinkButton } from "@/components/link-button";
import { ConfirmButton } from "@/components/confirm-dialog";
import { ToneBadge } from "@/components/status-badge";
import { UserAvatar } from "@/components/user-avatar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EditScheduleDialog } from "@/components/oncall/schedule-dialog";
import { OverrideDialog } from "@/components/oncall/override-dialog";
import { OnCallTimeline, type TimelinePerson } from "@/components/oncall/oncall-timeline";
import { activityMeta, cadenceLabel, formatInZone } from "@/components/oncall/format";
import { getT } from "@/lib/i18n/server";
import { INTL_LOCALE } from "@/lib/i18n/config";
import type { Translator } from "@/lib/i18n/translate";
import type { ScheduleFormValues } from "@/components/oncall/schedule-form";

export const dynamic = "force-dynamic";

const DAY_MS = 24 * 3_600_000;
const TIMELINE_DAYS = 14;
const OVERRIDE_HORIZON_DAYS = 365;
const SHIFT_LOOKAHEAD_DAYS = 60;

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const schedule = await db.onCallSchedule.findUnique({ where: { id }, select: { name: true } });
  const t = await getT("oncall");
  return { title: schedule?.name ?? t("schedule") };
}

function Prop({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <div className="text-sm">{children}</div>
    </div>
  );
}

/** Why nobody holds the schedule right now, in words a first-time reader can act on. */
function nobodyMessage(schedule: LoadedSchedule, now: Date, canManage: boolean, t: Translator<"oncall">): string {
  if (!schedule.isActive) return t("nobodyInactive");
  if (schedule.members.length === 0) {
    return canManage ? t("nobodyNoMembersManager") : t("nobodyNoMembers");
  }
  if (schedule.rotationStart > now) {
    return t("nobodyBeforeStart", { date: formatInZone(schedule.rotationStart, schedule.timezone, INTL_LOCALE[t.locale]) });
  }
  return t("nobodyNow");
}

/** The first stretch in the next weeks that the rotation (ignoring overrides) gives `userId`: what a swap should pre-fill. */
function nextOwnShift(schedule: LoadedSchedule, userId: string, now: Date): { startsAt: Date; endsAt: Date } | undefined {
  const horizon = new Date(now.getTime() + SHIFT_LOOKAHEAD_DAYS * DAY_MS);
  const mine = buildTimeline({ ...toScheduleInput(schedule), overrides: [] }, now, horizon).find((s) => s.userId === userId);
  return mine ? { startsAt: mine.start, endsAt: mine.end } : undefined;
}

function nextHandoff(timeline: TimelineSegment[], people: Map<string, TimelinePerson>, timezone: string, t: Translator<"oncall">) {
  const next = timeline[1];
  const person = next?.userId ? people.get(next.userId) : null;
  return next && person
    ? t("nextHandoff", { name: person.name ?? person.email, date: formatInZone(next.start, timezone, INTL_LOCALE[t.locale]) })
    : null;
}

export default async function OnCallSchedulePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await requireRole("AGENT");
  const now = new Date();
  const timelineEnd = new Date(now.getTime() + TIMELINE_DAYS * DAY_MS);
  const overrideHorizon = new Date(now.getTime() + OVERRIDE_HORIZON_DAYS * DAY_MS);

  const [[schedule], options] = await Promise.all([loadSchedules({ id }, now, overrideHorizon), getFormOptions()]);
  if (!schedule) notFound();
  const [t, tc] = await Promise.all([getT("oncall"), getT("common")]);
  const intl = INTL_LOCALE[t.locale];
  const inZone = (d: Date) => formatInZone(d, schedule.timezone, intl);

  const isManager = hasRole(me.role, "MANAGER");
  const canSwap = !isManager && schedule.members.some((m) => m.id === me.id);
  const timeline = buildTimeline(toScheduleInput(schedule), now, timelineEnd);
  const holder = schedule.isActive ? onCallPersonAt(schedule, now) : null;
  const holderUntil = timeline[0]?.end ?? timelineEnd;

  const people = new Map<string, TimelinePerson>();
  for (const p of [...schedule.members, ...schedule.overrides.map((o) => o.user)]) people.set(p.id, p);
  const nextUp = schedule.isActive ? nextHandoff(timeline, people, schedule.timezone, t) : null;
  const nextRotationMemberId = schedule.isActive && timeline[1]?.source === "ROTATION" ? timeline[1].userId : null;

  const rotationMeta = ONCALL_ROTATION_META[schedule.rotationType as OnCallRotationType] ?? ONCALL_ROTATION_META.CUSTOM;
  const start = localDate(schedule.rotationStart, schedule.timezone);
  const initial: ScheduleFormValues = {
    name: schedule.name,
    description: schedule.description,
    groupId: schedule.group.id,
    timezone: schedule.timezone,
    rotationType: schedule.rotationType,
    customIntervalHours: schedule.customIntervalHours,
    handoffTime: schedule.handoffTime,
    startDate: `${start.year}-${String(start.month).padStart(2, "0")}-${String(start.day).padStart(2, "0")}`,
    isActive: schedule.isActive,
    memberIds: schedule.members.map((m) => m.id),
  };

  const overrideAction =
    isManager || canSwap ? (
      <OverrideDialog
        scheduleId={schedule.id}
        timezone={schedule.timezone}
        candidates={options.agents}
        rotationMembers={schedule.members}
        swapForUserId={canSwap ? me.id : undefined}
        suggestedWindow={canSwap ? nextOwnShift(schedule, me.id, now) : undefined}
      />
    ) : null;

  return (
    <div data-viewport-pane className="grid gap-0 lg:h-full lg:grid-cols-[1fr_320px] lg:overflow-hidden">
      {/* Main column: scrolls independently from the properties rail */}
      <div className="min-w-0 border-b lg:min-h-0 lg:overflow-y-auto lg:border-b-0 lg:border-r">
        <div className="flex flex-wrap items-center gap-3 border-b px-4 py-3 sm:px-6">
          <LinkButton href="/oncall" variant="ghost" size="icon-sm" aria-label={t("backToOnCall")}>
            <ArrowLeft className="size-4" />
          </LinkButton>
          <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: schedule.group.color }} aria-hidden />
          <Link href={`/groups/${schedule.group.id}`} className="text-sm font-medium hover:text-primary">{schedule.group.name}</Link>
          <ToneBadge meta={rotationMeta} icon={false} />
          <ToneBadge meta={activityMeta(schedule.isActive, tc)} dot />
          {isManager ? (
            <div className="ml-auto flex items-center gap-2">
              <EditScheduleDialog scheduleId={schedule.id} initial={initial} groups={options.groups} agents={options.agents} />
              <ConfirmButton
                action={setScheduleActive}
                fields={{ id: schedule.id, active: String(!schedule.isActive) }}
                title={schedule.isActive ? t("deactivateTitle") : t("activateTitle")}
                description={
                  schedule.isActive
                    ? t("deactivateDescription", { team: schedule.group.name, name: schedule.name })
                    : t("activateDescription", { team: schedule.group.name, name: schedule.name })
                }
                confirmLabel={schedule.isActive ? t("deactivate") : t("activate")}
                confirmVariant="default"
                triggerVariant="outline"
                triggerSize="default"
              >
                {schedule.isActive ? t("deactivate") : t("activate")}
              </ConfirmButton>
              <ConfirmButton
                action={deleteSchedule}
                fields={{ id: schedule.id }}
                title={t("deleteTitle")}
                description={t("deleteDescription", { name: schedule.name, team: schedule.group.name })}
                confirmLabel={t("deleteSchedule")}
                triggerVariant="outline"
                triggerSize="icon-sm"
                triggerLabel={t("deleteSchedule")}
                triggerClassName="text-muted-foreground hover:border-destructive/40 hover:text-destructive"
              >
                <Trash2 className="size-4" />
              </ConfirmButton>
            </div>
          ) : null}
        </div>

        <div className="grid gap-4 p-4 sm:p-6">
          <div>
            <h1 className="font-display text-2xl font-semibold tracking-tight">{schedule.name}</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {schedule.description ?? t("rotationFor", { team: schedule.group.name })}
            </p>
          </div>

          <Card>
            <CardHeader><CardTitle className="text-sm">{t("colOnCallNow")}</CardTitle></CardHeader>
            <CardContent className="grid gap-2">
              {holder ? (
                <>
                  <div className="flex items-center gap-3">
                    <UserAvatar name={holder.name} email={holder.email} />
                    <div className="min-w-0">
                      <div className="truncate font-medium">{holder.name ?? holder.email}</div>
                      <div className="text-xs text-muted-foreground">{t("until", { date: inZone(holderUntil) })}</div>
                    </div>
                  </div>
                  {nextUp ? <p className="text-xs text-muted-foreground">{nextUp}</p> : null}
                  {holder.isActive ? null : (
                    <p className="text-xs text-destructive">{t("accountDeactivated")}</p>
                  )}
                </>
              ) : (
                <p className="text-sm font-medium text-destructive">{nobodyMessage(schedule, now, isManager, t)}</p>
              )}
            </CardContent>
          </Card>

          <Card className={schedule.isActive ? undefined : "opacity-60"}>
            <CardHeader>
              <CardTitle className="text-sm">{t("nextDays", { days: TIMELINE_DAYS })}</CardTitle>
              {schedule.isActive ? null : <p className="text-xs text-muted-foreground">{t("inactivePlan")}</p>}
            </CardHeader>
            <CardContent>
              <OnCallTimeline
                segments={timeline}
                people={people}
                from={now}
                to={timelineEnd}
                timezone={schedule.timezone}
                now={now}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="grid-cols-[1fr_auto] items-center">
              <div className="grid gap-1">
                <CardTitle className="text-sm">{t("overrides")}</CardTitle>
                <p className="text-xs text-muted-foreground">
                  {t("overridesHint")}
                </p>
              </div>
              {overrideAction}
            </CardHeader>
            <CardContent>
              {schedule.overrides.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {overrideAction ? t("noOverridesWithAction") : t("noOverrides")}
                </p>
              ) : (
                <ul className="divide-y">
                  {schedule.overrides.map((o) => (
                    <li key={o.id} className="flex items-start gap-2.5 py-2 text-sm first:pt-0 last:pb-0">
                      <UserAvatar name={o.user.name} email={o.user.email} size="xs" className="mt-0.5" />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                          <span className="truncate font-medium">{o.user.name ?? o.user.email}</span>
                          {o.replaces ? <span className="text-muted-foreground">{t("covers", { name: o.replaces.name ?? o.replaces.email })}</span> : null}
                          {o.startsAt <= now ? <ToneBadge meta={{ label: t("inEffect"), tone: "info" }} icon={false} /> : null}
                        </div>
                        <div className="flex items-center gap-1 text-xs text-muted-foreground">
                          <CalendarClock className="size-3" />
                          {inZone(o.startsAt)} – {inZone(o.endsAt)}
                        </div>
                        {o.reason ? <div className="text-xs text-muted-foreground">{o.reason}</div> : null}
                      </div>
                      {canRemoveOverride({ id: me.id, isManager }, { replacesUserId: o.replaces?.id ?? null }) ? (
                        <ConfirmButton
                          action={deleteOverride}
                          fields={{ id: o.id, scheduleId: schedule.id }}
                          title={t("removeOverrideTitle")}
                          description={t("removeOverrideDescription")}
                          confirmLabel={t("remove")}
                          triggerVariant="ghost"
                          triggerLabel={t("removeOverride")}
                        >
                          <Trash2 className="size-4 text-muted-foreground" />
                        </ConfirmButton>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Sidebar */}
      <aside className="grid content-start gap-4 p-4 sm:p-6 lg:min-h-0 lg:overflow-y-auto">
        <Card>
          <CardHeader><CardTitle className="text-sm">{tc("properties")}</CardTitle></CardHeader>
          <CardContent className="grid gap-4">
            <Prop label={t("team")}>
              <Link href={`/groups/${schedule.group.id}`} className="inline-flex items-center gap-2 font-medium hover:text-primary">
                <span className="size-2.5 rounded-full" style={{ backgroundColor: schedule.group.color }} aria-hidden />
                {schedule.group.name}
              </Link>
            </Prop>
            <Prop label={t("rotation")}>
              {cadenceLabel(schedule.rotationType, schedule.customIntervalHours, t)}
              {schedule.rotationType === "CUSTOM" ? "" : t("handingOffAt", { time: schedule.handoffTime })}
            </Prop>
            <Prop label={t("timeZone")}>{schedule.timezone}</Prop>
            <Prop label={t("firstHandoff")}>{inZone(schedule.rotationStart)}</Prop>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">{t("rotationOrder", { count: schedule.members.length })}</CardTitle>
            <p className="text-xs text-muted-foreground">{t("rotationOrderHint")}</p>
          </CardHeader>
          <CardContent>
            {schedule.members.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("noOneInRotation")}</p>
            ) : (
              <ol className="grid gap-2">
                {schedule.members.map((m, index) => (
                  <li key={m.id} className="flex items-center gap-2.5 text-sm">
                    <span className="w-4 text-xs tabular-nums text-muted-foreground">{index + 1}</span>
                    <UserAvatar name={m.name} email={m.email} size="xs" />
                    <span className="min-w-0 flex-1 truncate">{m.name ?? m.email}</span>
                    {m.isActive ? null : <ToneBadge meta={{ label: t("deactivated"), tone: "danger" }} icon={false} />}
                    {m.id === holder?.id ? <ToneBadge meta={{ label: t("onCall"), tone: "success" }} icon={false} /> : null}
                    {m.id === nextRotationMemberId && m.id !== holder?.id ? <ToneBadge meta={{ label: t("next"), tone: "neutral" }} icon={false} /> : null}
                  </li>
                ))}
              </ol>
            )}
          </CardContent>
        </Card>
      </aside>
    </div>
  );
}
