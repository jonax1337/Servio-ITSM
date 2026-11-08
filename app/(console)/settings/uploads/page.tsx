import type { Metadata } from "next";
import { UploadCloud } from "lucide-react";
import { requireRole } from "@/lib/session";
import { getSetting } from "@/lib/settings";
import { PageHeader, PageBody } from "@/components/page-header";
import { SettingsForm } from "@/components/settings/settings-form";
import { saveUploadSettings } from "@/lib/actions/settings";
import { getT } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT("settings");
  return { title: t("uploads.metaTitle") };
}
export const dynamic = "force-dynamic";

export default async function UploadSettingsPage() {
  await requireRole("ADMIN");
  const t = await getT("settings");
  const [maxMb, gotenbergUrl] = await Promise.all([
    getSetting("MAX_UPLOAD_MB", "15"),
    getSetting("GOTENBERG_URL", ""),
  ]);

  return (
    <>
      <PageHeader
        icon={UploadCloud}
        title={t("uploads.title")}
        description={t("uploads.description")}
      />
      <PageBody className="max-w-2xl">
        <SettingsForm
          action={saveUploadSettings}
          fields={[
            {
              type: "number",
              name: "MAX_UPLOAD_MB",
              label: t("uploads.maxMb"),
              defaultValue: maxMb ?? "15",
              placeholder: "15",
              hint: t("uploads.maxMbHint"),
            },
            {
              type: "text",
              name: "GOTENBERG_URL",
              label: t("uploads.gotenberg"),
              defaultValue: gotenbergUrl ?? "",
              placeholder: "http://gotenberg:3000",
              hint: t("uploads.gotenbergHint"),
            },
          ]}
        />
      </PageBody>
    </>
  );
}
