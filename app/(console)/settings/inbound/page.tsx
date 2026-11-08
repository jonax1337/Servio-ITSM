import type { Metadata } from "next";
import { Inbox } from "lucide-react";
import Link from "next/link";
import { requireRole } from "@/lib/session";
import { getSetting, getBoolSetting, settingIsSet } from "@/lib/settings";
import { PageHeader, PageBody } from "@/components/page-header";
import { SettingsForm } from "@/components/settings/settings-form";
import { saveInboundSettings } from "@/lib/actions/settings";
import { getT } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT("settings");
  return { title: t("inbound.metaTitle") };
}
export const dynamic = "force-dynamic";

export default async function InboundSettingsPage() {
  await requireRole("ADMIN");
  const t = await getT("settings");
  const [enabled, host, port, secure, user, folder, poll, plus, passSet] = await Promise.all([
    getBoolSetting("IMAP_ENABLED"),
    getSetting("IMAP_HOST", ""),
    getSetting("IMAP_PORT", "993"),
    getBoolSetting("IMAP_SECURE", true),
    getSetting("IMAP_USER", ""),
    getSetting("IMAP_FOLDER", "INBOX"),
    getSetting("IMAP_POLL_SECONDS", "60"),
    getBoolSetting("MAIL_PLUS_ADDRESSING"),
    settingIsSet("IMAP_PASS"),
  ]);

  return (
    <>
      <PageHeader
        icon={Inbox}
        title={t("inbound.title")}
        description={t("inbound.description")}
      />
      <PageBody className="grid max-w-2xl gap-4">
        <SettingsForm
          action={saveInboundSettings}
          fields={[
            { type: "switch", name: "IMAP_ENABLED", label: t("inbound.enabled"), defaultChecked: enabled, hint: t("inbound.enabledHint") },
            { type: "text", name: "IMAP_HOST", label: t("mailField.host"), defaultValue: host ?? "", placeholder: "imap.example.com" },
            { type: "number", name: "IMAP_PORT", label: t("mailField.port"), defaultValue: port ?? "993", placeholder: "993" },
            { type: "switch", name: "IMAP_SECURE", label: t("inbound.secure"), defaultChecked: secure },
            { type: "text", name: "IMAP_USER", label: t("mailField.username"), defaultValue: user ?? "", placeholder: "support@example.com" },
            { type: "password", name: "IMAP_PASS", label: t("mailField.password"), isSet: passSet },
            { type: "text", name: "IMAP_FOLDER", label: t("inbound.folder"), defaultValue: folder ?? "INBOX", placeholder: "INBOX" },
            { type: "number", name: "IMAP_POLL_SECONDS", label: t("inbound.poll"), defaultValue: poll ?? "60", placeholder: "60" },
            { type: "switch", name: "MAIL_PLUS_ADDRESSING", label: t("inbound.plus"), defaultChecked: plus },
          ]}
        />
        <p className="text-sm text-muted-foreground">
          {t.rich("inbound.matchHint", {
            tag: <code className="font-mono text-xs">[INC-123]</code>,
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
