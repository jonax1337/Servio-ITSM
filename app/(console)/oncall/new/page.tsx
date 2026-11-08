import type { Metadata } from "next";
import { PhoneCall } from "lucide-react";
import { requireRole } from "@/lib/session";
import { getFormOptions } from "@/lib/data/options";
import { PageHeader, PageBody } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { ScheduleForm, type ScheduleFormValues } from "@/components/oncall/schedule-form";
import { getT } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT("oncall");
  return { title: t("newTitle") };
}
export const dynamic = "force-dynamic";

export default async function NewOnCallSchedulePage() {
  await requireRole("MANAGER");
  const options = await getFormOptions();
  const t = await getT("oncall");

  const initial: ScheduleFormValues = {
    name: "",
    description: null,
    groupId: options.groups[0]?.id ?? "",
    timezone: "UTC",
    rotationType: "WEEKLY",
    customIntervalHours: null,
    handoffTime: "09:00",
    startDate: "", // the form defaults it to today in the chosen time zone
    isActive: true,
    memberIds: [],
  };

  return (
    <>
      <PageHeader
        icon={PhoneCall}
        title={t("newTitle")}
        description={t("newDescription")}
      />
      <PageBody className="mx-auto max-w-3xl">
        <Card>
          <CardContent>
            <ScheduleForm initial={initial} groups={options.groups} agents={options.agents} />
          </CardContent>
        </Card>
      </PageBody>
    </>
  );
}
