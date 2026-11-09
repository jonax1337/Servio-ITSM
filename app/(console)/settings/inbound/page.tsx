import type { Metadata } from "next";
import { Inbox } from "lucide-react";
import Link from "next/link";
import { requireRole } from "@/lib/session";
import { getSetting, getBoolSetting, settingIsSet } from "@/lib/settings";
import { PageHeader, PageBody } from "@/components/page-header";
import { SettingsForm } from "@/components/settings/settings-form";
import { saveInboundPolicySettings, saveInboundProcessingSettings, saveInboundSettings } from "@/lib/actions/settings";
import { getT } from "@/lib/i18n/server";
import {
  INBOUND_ALLOWED_DOMAINS_SETTING,
  INBOUND_DENY_LIST_SETTING,
  INBOUND_REJECT_AUTOREPLY_SETTING,
  INBOUND_REJECT_REQUIRE_AUTH_SETTING,
  INBOUND_SENDER_POLICIES,
  INBOUND_SENDER_POLICY_SETTING,
  parseSenderPolicy,
} from "@/lib/mail-inbound/policy";
import {
  DEFAULT_PROCESSED_FOLDER,
  IMAP_PROCESSED_ACTION_SETTING,
  IMAP_PROCESSED_FOLDER_SETTING,
  IMAP_RETENTION_DAYS_SETTING,
  INBOUND_DISPOSITIONS,
  parseDisposition,
} from "@/lib/mail-inbound/disposition";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT("settings");
  return { title: t("inbound.metaTitle") };
}
export const dynamic = "force-dynamic";

function Section({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <section className="grid gap-3">
      <div>
        <h2 className="text-sm font-semibold">{title}</h2>
        {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {children}
    </section>
  );
}

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
  const [processedAction, processedFolder, retentionDays, policy, allowedDomains, denyList, autoReply, requireAuth] = await Promise.all([
    getSetting(IMAP_PROCESSED_ACTION_SETTING),
    getSetting(IMAP_PROCESSED_FOLDER_SETTING, ""),
    getSetting(IMAP_RETENTION_DAYS_SETTING, "0"),
    getSetting(INBOUND_SENDER_POLICY_SETTING),
    getSetting(INBOUND_ALLOWED_DOMAINS_SETTING, ""),
    getSetting(INBOUND_DENY_LIST_SETTING, ""),
    getBoolSetting(INBOUND_REJECT_AUTOREPLY_SETTING),
    getBoolSetting(INBOUND_REJECT_REQUIRE_AUTH_SETTING, true),
  ]);

  return (
    <>
      <PageHeader
        icon={Inbox}
        title={t("inbound.title")}
        description={t("inbound.description")}
      />
      <PageBody className="grid max-w-2xl gap-8">
        <Section title={t("inbound.connectionTitle")}>
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
        </Section>

        <Section title={t("inbound.processingTitle")} description={t("inbound.processingDescription")}>
          <SettingsForm
            action={saveInboundProcessingSettings}
            fields={[
              {
                type: "select",
                name: IMAP_PROCESSED_ACTION_SETTING,
                label: t("inbound.processedAction"),
                defaultValue: parseDisposition(processedAction),
                options: INBOUND_DISPOSITIONS.map((d) => ({ value: d, label: t.dyn(`inbound.processedAction.${d}`) })),
              },
              {
                type: "text",
                name: IMAP_PROCESSED_FOLDER_SETTING,
                label: t("inbound.processedFolder"),
                defaultValue: processedFolder ?? "",
                placeholder: DEFAULT_PROCESSED_FOLDER,
                hint: t("inbound.processedFolderHint"),
              },
              {
                type: "number",
                name: IMAP_RETENTION_DAYS_SETTING,
                label: t("inbound.retentionDays"),
                defaultValue: retentionDays ?? "0",
                placeholder: "0",
                hint: t("inbound.retentionDaysHint"),
              },
            ]}
          />
        </Section>

        <Section title={t("inbound.policyTitle")} description={t("inbound.policyDescription")}>
          <SettingsForm
            action={saveInboundPolicySettings}
            fields={[
              {
                type: "select",
                name: INBOUND_SENDER_POLICY_SETTING,
                label: t("inbound.policy"),
                defaultValue: parseSenderPolicy(policy),
                options: INBOUND_SENDER_POLICIES.map((p) => ({ value: p, label: t.dyn(`inbound.policy.${p}`) })),
                hint: t("inbound.policyWarning"),
              },
              {
                type: "text",
                name: INBOUND_ALLOWED_DOMAINS_SETTING,
                label: t("inbound.allowedDomains"),
                defaultValue: allowedDomains ?? "",
                placeholder: "example.com, partner.example",
                hint: t("inbound.allowedDomainsHint"),
              },
              {
                type: "text",
                name: INBOUND_DENY_LIST_SETTING,
                label: t("inbound.denyList"),
                defaultValue: denyList ?? "",
                placeholder: "newsletter@example.com, ads.example",
                hint: t("inbound.denyListHint"),
              },
              {
                type: "switch",
                name: INBOUND_REJECT_AUTOREPLY_SETTING,
                label: t("inbound.autoReply"),
                defaultChecked: autoReply,
                hint: t("inbound.autoReplyHint"),
              },
              {
                type: "switch",
                name: INBOUND_REJECT_REQUIRE_AUTH_SETTING,
                label: t("inbound.requireAuth"),
                defaultChecked: requireAuth,
                hint: t("inbound.requireAuthHint"),
              },
            ]}
          />
        </Section>
      </PageBody>
    </>
  );
}
