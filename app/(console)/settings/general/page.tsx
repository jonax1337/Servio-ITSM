import type { Metadata } from "next";
import { Palette } from "lucide-react";
import { requireRole } from "@/lib/session";
import { getSetting } from "@/lib/settings";
import { PageHeader, PageBody } from "@/components/page-header";
import { SettingsForm } from "@/components/settings/settings-form";
import { saveGeneralSettings } from "@/lib/actions/settings";
import { LOCALES, LOCALE_NAMES } from "@/lib/i18n/config";
import { getInstanceLocale } from "@/lib/i18n/server";

export const metadata: Metadata = { title: "General settings" };
export const dynamic = "force-dynamic";

export default async function GeneralSettingsPage() {
  await requireRole("ADMIN");
  const [appName, appUrl, instanceLocale] = await Promise.all([
    getSetting("APP_NAME", "Servio"),
    getSetting("APP_URL", ""),
    getInstanceLocale(),
  ]);

  return (
    <>
      <PageHeader
        icon={Palette}
        title="General & branding"
        description="The application name and public URL used across the app and emails."
      />
      <PageBody className="max-w-2xl">
        <SettingsForm
          action={saveGeneralSettings}
          fields={[
            {
              type: "text",
              name: "APP_NAME",
              label: "Application name",
              defaultValue: appName ?? "",
              placeholder: "Servio",
              hint: "Shown in the UI and used by the AI assistant as the org name.",
            },
            {
              type: "text",
              name: "APP_URL",
              label: "Public URL",
              defaultValue: appUrl ?? "",
              placeholder: "https://servio.example.com",
            },
            {
              type: "select",
              name: "APP_LOCALE",
              label: "Default language",
              defaultValue: instanceLocale,
              options: LOCALES.map((l) => ({ value: l, label: LOCALE_NAMES[l] })),
              hint: "For the console, the portal and emails — unless a user picks a language in their account settings. Env: APP_LOCALE.",
            },
          ]}
        />
      </PageBody>
    </>
  );
}
