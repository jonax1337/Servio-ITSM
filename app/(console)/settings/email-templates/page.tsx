import type { Metadata } from "next";
import { MailCheck } from "lucide-react";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/session";
import { getTicketAutoCloseDays } from "@/lib/settings";
import { mailBrand } from "@/lib/mail";
import { signatureHtml, textToHtmlParagraphs } from "@/lib/mail-template";
import {
  TEMPLATE_KEYS, TEMPLATE_META, DEFAULT_TEMPLATES, approvalStageText, autoCloseNoticeHtml, previewTemplate, quotedTextHtml,
  type TemplateKey,
} from "@/lib/email-templates";
import { PageHeader, PageBody } from "@/components/page-header";
import { EmailTemplateEditor } from "@/components/settings/email-template-editor";
import { getT } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT("settings");
  return { title: t("emailTemplates.metaTitle") };
}
export const dynamic = "force-dynamic";

/** Template placeholders named in descriptions, passed through literally. */
const PLACEHOLDER_VARS = {
  quote: "{{quote}}",
  resolution: "{{resolution}}",
  survey: "{{survey}}",
  autoCloseDays: "{{autoCloseDays}}",
  autoCloseNotice: "{{autoCloseNotice}}",
  details: "{{details}}",
  stage: "{{stage}}",
  comment: "{{comment}}",
  subject: "{{subject}}",
  message: "{{message}}",
  link: "{{link}}",
};

export default async function EmailTemplatesPage() {
  await requireRole("ADMIN");
  const t = await getT("settings");
  const [rows, brand, autoCloseDays] = await Promise.all([db.emailTemplate.findMany(), mailBrand(), getTicketAutoCloseDays()]);
  const byKey = new Map(rows.map((r) => [r.key, r]));

  // Sample data used to render the live previews.
  const sampleVars: Record<string, string> = {
    appName: brand.appName ?? "Servio",
    ref: "INC-0042",
    title: t("emailTemplates.sampleTitle"),
    requesterName: "Max Sample",
    agentName: "Alex Admin",
    message: textToHtmlParagraphs(t("emailTemplates.sampleMessage")),
    signature: signatureHtml(textToHtmlParagraphs("Alex Admin\nService Desk")),
    // The preview follows Settings › Tickets: empty while automatic closing is off.
    autoCloseDays: autoCloseDays > 0 ? String(autoCloseDays) : "",
    autoCloseNotice: autoCloseNoticeHtml(autoCloseDays, brand.locale),
    itemName: t("emailTemplates.sampleItem"),
    approverName: "Alex Admin",
    stage: approvalStageText(0, 2, brand.locale),
    details: quotedTextHtml(t("emailTemplates.sampleDetails")),
    comment: quotedTextHtml(t("emailTemplates.sampleComment")),
    recipientName: "Alex Admin",
    subject: `[INC-0042] ${t("emailTemplates.sampleTitle")}`,
  };
  const ctx = { brand, vars: sampleVars };

  return (
    <>
      <PageHeader
        icon={MailCheck}
        title={t("emailTemplates.title")}
        description={t("emailTemplates.description")}
      />
      <PageBody className="grid max-w-3xl gap-5">
        {TEMPLATE_KEYS.map((key: TemplateKey) => {
          const row = byKey.get(key);
          const subject = row?.subject ?? DEFAULT_TEMPLATES[key].subject;
          const bodyHtml = row?.bodyHtml ?? DEFAULT_TEMPLATES[key].bodyHtml;
          const preview = previewTemplate({ subject, bodyHtml }, ctx);
          return (
            <EmailTemplateEditor
              key={key}
              templateKey={key}
              label={t.dyn(`template.${key}.label`, undefined, TEMPLATE_META[key].label)}
              description={t.dyn(`template.${key}.description`, PLACEHOLDER_VARS, TEMPLATE_META[key].description)}
              vars={TEMPLATE_META[key].vars}
              subject={subject}
              bodyHtml={bodyHtml}
              enabled={row?.enabled ?? true}
              customized={!!row}
              previewHtml={preview.html}
            />
          );
        })}
      </PageBody>
    </>
  );
}
