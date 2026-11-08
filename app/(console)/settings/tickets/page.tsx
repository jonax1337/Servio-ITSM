import type { Metadata } from "next";
import { Ticket } from "lucide-react";
import { requireRole } from "@/lib/session";
import { TICKET_CLOSED_EMAIL_SETTING, getTicketAutoCloseDays, getTicketClosedEmailEnabled } from "@/lib/settings";
import { TICKET_AUTO_CLOSE_DAYS_SETTING } from "@/lib/auto-close-rules";
import { PageHeader, PageBody } from "@/components/page-header";
import { SettingsForm } from "@/components/settings/settings-form";
import { saveTicketSettings } from "@/lib/actions/settings";
import { getT } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT("settings");
  return { title: t("tickets.metaTitle") };
}
export const dynamic = "force-dynamic";

export default async function TicketSettingsPage() {
  await requireRole("ADMIN");
  const [t, autoCloseDays, closedEmail] = await Promise.all([getT("settings"), getTicketAutoCloseDays(), getTicketClosedEmailEnabled()]);

  return (
    <>
      <PageHeader icon={Ticket} title={t("tickets.title")} description={t("tickets.description")} />
      <PageBody className="max-w-2xl">
        <SettingsForm
          action={saveTicketSettings}
          fields={[
            {
              type: "number",
              name: TICKET_AUTO_CLOSE_DAYS_SETTING,
              label: t("tickets.autoCloseDays"),
              defaultValue: String(autoCloseDays),
              placeholder: "0",
              hint: t("tickets.autoCloseDaysHint", { autoCloseDays: "{{autoCloseDays}}", autoCloseNotice: "{{autoCloseNotice}}" }),
            },
            {
              type: "switch",
              name: TICKET_CLOSED_EMAIL_SETTING,
              label: t("tickets.closedEmail"),
              defaultChecked: closedEmail,
              hint: t("tickets.closedEmailHint"),
            },
          ]}
        />
      </PageBody>
    </>
  );
}
