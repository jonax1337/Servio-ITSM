import type { Metadata } from "next";
import { GitPullRequestArrow } from "lucide-react";
import { requireRole } from "@/lib/session";
import { CHANGE_SELF_APPROVAL_SETTING, getChangeSelfApprovalMode } from "@/lib/settings";
import type { ChangeSelfApprovalMode } from "@/lib/approval-rules";
import { PageHeader, PageBody } from "@/components/page-header";
import { SettingsForm } from "@/components/settings/settings-form";
import { saveChangeSettings } from "@/lib/actions/settings";
import { getT } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT("settings");
  return { title: t("changes.metaTitle") };
}
export const dynamic = "force-dynamic";

export default async function ChangeSettingsPage() {
  await requireRole("ADMIN");
  const [t, mode] = await Promise.all([getT("settings"), getChangeSelfApprovalMode()]);
  const modeLabels: Record<ChangeSelfApprovalMode, string> = {
    OFF: t("changes.mode.off"),
    WHEN_NO_OTHER_APPROVER: t("changes.mode.whenNoOtherApprover"),
    ALWAYS: t("changes.mode.always"),
  };

  return (
    <>
      <PageHeader
        icon={GitPullRequestArrow}
        title={t("changes.title")}
        description={t("changes.description")}
      />
      <PageBody className="max-w-2xl">
        <SettingsForm
          action={saveChangeSettings}
          fields={[
            {
              type: "select",
              name: CHANGE_SELF_APPROVAL_SETTING,
              label: t("changes.selfApproval"),
              defaultValue: mode,
              options: Object.entries(modeLabels).map(([value, label]) => ({ value, label })),
              hint: t("changes.selfApprovalHint"),
            },
          ]}
        />
      </PageBody>
    </>
  );
}
