import type { Metadata } from "next";
import { Palette } from "lucide-react";
import { requireRole } from "@/lib/session";
import { db } from "@/lib/db";
import { getSetting, PORTAL_TRIAGE_GROUP_SETTING } from "@/lib/settings";
import { PageHeader, PageBody } from "@/components/page-header";
import { SettingsForm } from "@/components/settings/settings-form";
import { saveGeneralSettings } from "@/lib/actions/settings";
import { LOCALES, LOCALE_NAMES } from "@/lib/i18n/config";
import { getInstanceLocale, getT } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT("settings");
  return { title: t("general.metaTitle") };
}
export const dynamic = "force-dynamic";

export default async function GeneralSettingsPage() {
  await requireRole("ADMIN");
  const t = await getT("settings");
  const [appName, appUrl, instanceLocale, triageGroupId, groups] = await Promise.all([
    getSetting("APP_NAME", "Servio"),
    getSetting("APP_URL", ""),
    getInstanceLocale(),
    getSetting(PORTAL_TRIAGE_GROUP_SETTING),
    db.group.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);

  return (
    <>
      <PageHeader
        icon={Palette}
        title={t("general.title")}
        description={t("general.description")}
      />
      <PageBody className="max-w-2xl">
        <SettingsForm
          action={saveGeneralSettings}
          fields={[
            {
              type: "text",
              name: "APP_NAME",
              label: t("general.appName"),
              defaultValue: appName ?? "",
              placeholder: "Servio",
              hint: t("general.appNameHint"),
            },
            {
              type: "text",
              name: "APP_URL",
              label: t("general.appUrl"),
              defaultValue: appUrl ?? "",
              placeholder: "https://servio.example.com",
            },
            {
              type: "select",
              name: "APP_LOCALE",
              label: t("general.defaultLanguage"),
              defaultValue: instanceLocale,
              options: LOCALES.map((l) => ({ value: l, label: LOCALE_NAMES[l] })),
              hint: t("general.defaultLanguageHint"),
            },
            {
              type: "select",
              name: PORTAL_TRIAGE_GROUP_SETTING,
              label: t("general.triageGroup"),
              defaultValue: triageGroupId ?? "none",
              options: [
                { value: "none", label: t("general.triageGroupDefault") },
                ...groups.map((g) => ({ value: g.id, label: g.name })),
              ],
              hint: t("general.triageGroupHint"),
            },
          ]}
        />
      </PageBody>
    </>
  );
}
