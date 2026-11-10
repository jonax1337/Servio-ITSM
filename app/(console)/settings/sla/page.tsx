import type { Metadata } from "next";
import { Timer } from "lucide-react";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/session";
import { PageHeader, PageBody } from "@/components/page-header";
import { SlaManager } from "@/components/settings/sla-manager";
import { CalendarManager } from "@/components/settings/calendar-manager";
import { EscalationManager } from "@/components/settings/escalation-manager";
import { SlaSettingsTabs } from "./tabs";
import { getT } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT("settings");
  return { title: t("sla.metaTitle") };
}
export const dynamic = "force-dynamic";

export default async function SlaSettingsPage() {
  await requireRole("MANAGER");
  const t = await getT("settings");

  const [slas, calendars, policies, groups, users] = await Promise.all([
    db.sLA.findMany({
      orderBy: [{ isActive: "desc" }, { resolveMins: "asc" }],
      select: {
        id: true, name: true, description: true, priority: true,
        responseMins: true, resolveMins: true, isActive: true,
        businessCalendarId: true, escalationPolicyId: true,
      },
    }),
    db.businessCalendar.findMany({
      orderBy: { name: "asc" },
      select: {
        id: true, name: true, timezone: true, weeklyHours: true, holidayRegion: true,
        holidays: { orderBy: { date: "asc" }, select: { id: true, name: true, date: true, generated: true } },
      },
    }),
    db.escalationPolicy.findMany({
      orderBy: { name: "asc" },
      select: {
        id: true, name: true,
        steps: {
          orderBy: [{ thresholdPercent: "asc" }, { order: "asc" }],
          select: {
            id: true, order: true, thresholdPercent: true, action: true,
            targetGroupId: true, targetUserId: true, bumpToPriority: true,
          },
        },
      },
    }),
    db.group.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
    db.user.findMany({
      where: { role: { in: ["ADMIN", "MANAGER", "AGENT"] }, isActive: true },
      select: { id: true, name: true, email: true },
      orderBy: { name: "asc" },
    }),
  ]);

  const calOptions = calendars.map((c) => ({ id: c.id, name: c.name }));
  const policyOptions = policies.map((p) => ({ id: p.id, name: p.name }));
  const groupOptions = groups.map((g) => ({ id: g.id, name: g.name }));
  const userOptions = users.map((u) => ({ id: u.id, name: u.name || u.email }));

  return (
    <>
      <PageHeader
        icon={Timer}
        title={t("sla.title")}
        description={t("sla.description")}
      />
      <PageBody>
        <SlaSettingsTabs
          slaCount={slas.length}
          calendarCount={calendars.length}
          policyCount={policies.length}
          sla={<SlaManager slas={slas} calendars={calOptions} policies={policyOptions} />}
          calendars={<CalendarManager calendars={calendars} />}
          escalation={<EscalationManager policies={policies} groups={groupOptions} users={userOptions} />}
        />
      </PageBody>
    </>
  );
}
