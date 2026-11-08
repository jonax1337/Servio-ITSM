import type { Metadata } from "next";
import { Mail } from "lucide-react";
import Link from "next/link";
import { requireRole } from "@/lib/session";
import { getSetting, getBoolSetting, settingIsSet } from "@/lib/settings";
import { PageHeader, PageBody } from "@/components/page-header";
import { SettingsForm } from "@/components/settings/settings-form";
import { saveEmailSettings } from "@/lib/actions/settings";
import { getT } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT("settings");
  return { title: t("email.metaTitle") };
}
export const dynamic = "force-dynamic";

export default async function EmailSettingsPage() {
  await requireRole("ADMIN");
  const t = await getT("settings");
  const [host, port, secure, user, from, passSet] = await Promise.all([
    getSetting("SMTP_HOST", ""),
    getSetting("SMTP_PORT", "587"),
    getBoolSetting("SMTP_SECURE"),
    getSetting("SMTP_USER", ""),
    getSetting("SMTP_FROM", ""),
    settingIsSet("SMTP_PASS"),
  ]);

  return (
    <>
      <PageHeader
        icon={Mail}
        title={t("email.title")}
        description={t("email.description")}
      />
      <PageBody className="grid max-w-2xl gap-4">
        <SettingsForm
          action={saveEmailSettings}
          fields={[
            { type: "text", name: "SMTP_HOST", label: t("mailField.host"), defaultValue: host ?? "", placeholder: "smtp.example.com" },
            { type: "number", name: "SMTP_PORT", label: t("mailField.port"), defaultValue: port ?? "587", placeholder: "587" },
            { type: "switch", name: "SMTP_SECURE", label: t("email.secure"), defaultChecked: secure },
            { type: "text", name: "SMTP_USER", label: t("mailField.username"), defaultValue: user ?? "", placeholder: t("email.userPlaceholder") },
            { type: "password", name: "SMTP_PASS", label: t("mailField.password"), isSet: passSet },
            { type: "text", name: "SMTP_FROM", label: t("email.from"), defaultValue: from ?? "", placeholder: "Servio <servio@example.com>" },
          ]}
        />
        <p className="text-sm text-muted-foreground">
          {t.rich("email.outboxHint", {
            link: (c) => (
              <Link href="/settings/mail" className="text-primary hover:underline">
                {c}
              </Link>
            ),
          })}
        </p>
      </PageBody>
    </>
  );
}
