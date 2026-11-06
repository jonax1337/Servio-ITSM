import type { Metadata } from "next";
import { PhoneCall } from "lucide-react";
import { requireRole } from "@/lib/session";
import { getFormOptions } from "@/lib/data/options";
import { PageHeader, PageBody } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { ScheduleForm, type ScheduleFormValues } from "@/components/oncall/schedule-form";

export const metadata: Metadata = { title: "New on-call schedule" };
export const dynamic = "force-dynamic";

export default async function NewOnCallSchedulePage() {
  await requireRole("MANAGER");
  const options = await getFormOptions();

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
        title="New on-call schedule"
        description="A rotation of agents who take turns being on call for a team."
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
