import type { Metadata } from "next";
import { Mail, CheckCircle2, Server, Inbox, ArrowUpRight, ArrowDownLeft } from "lucide-react";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/session";
import { smtpConfigured } from "@/lib/mail";
import { PageHeader, PageBody } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { EmptyState } from "@/components/empty-state";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { getFormatter, getT } from "@/lib/i18n/server";
import { parseInboundLogNote } from "@/lib/mail-inbound/log-note";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT("settings");
  return { title: t("mail.metaTitle") };
}
export const dynamic = "force-dynamic";

const MAIL_STATUS_META = {
  QUEUED: { label: "Queued", tone: "info" as const },
  SENT: { label: "Sent", tone: "success" as const },
  FAILED: { label: "Failed", tone: "danger" as const },
  RECEIVED: { label: "Received", tone: "purple" as const },
  SIMULATED: { label: "Simulated", tone: "neutral" as const },
  REJECTED: { label: "Rejected", tone: "warning" as const },
  ARCHIVED: { label: "Archived", tone: "neutral" as const },
  SUPPRESSED: { label: "Not sent (service account)", tone: "neutral" as const },
};

/** cc is stored as a JSON array string; parse it defensively for display. */
function parseList(v: string | null): string[] {
  if (!v) return [];
  try {
    const arr = JSON.parse(v);
    return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export default async function MailSettingsPage() {
  await requireRole("MANAGER");
  const [t, f] = await Promise.all([getT("settings"), getFormatter()]);
  const statusMeta = Object.fromEntries(
    Object.entries(MAIL_STATUS_META).map(([k, v]) => [k, { ...v, label: t.dyn(`mail.status.${k}`, undefined, v.label) }]),
  );
  const configured = await smtpConfigured();
  const [messages, sentCount] = await Promise.all([
    db.emailMessage.findMany({ orderBy: { createdAt: "desc" }, take: 50 }),
    db.emailMessage.count({ where: { status: "SENT" } }),
  ]);

  return (
    <>
      <PageHeader
        icon={Mail}
        title={t("mail.title")}
        description={t("mail.description")}
      />
      <PageBody className="grid gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <Server className="size-4 text-muted-foreground" /> {t("mail.delivery")}
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2 text-sm sm:grid-cols-3">
            <div className="flex items-center gap-2">
              {configured ? (
                <>
                  <CheckCircle2 className="size-4 text-emerald-500" />
                  <span>{t("mail.smtpConfigured")}</span>
                </>
              ) : (
                <>
                  <Inbox className="size-4 text-amber-500" />
                  <span>{t.rich("mail.outboxMode", { var: <code className="font-mono text-xs">SMTP_HOST</code> })}</span>
                </>
              )}
            </div>
            <div className="text-muted-foreground">
              {t("mail.totalSent")} <span className="font-medium text-foreground">{sentCount}</span>
            </div>
          </CardContent>
        </Card>

        {messages.length === 0 ? (
          <EmptyState icon={Mail} title={t("mail.emptyTitle")} description={t("mail.emptyDescription")} />
        ) : (
          <div className="overflow-hidden rounded-xl border bg-card">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>{t("mail.colRecipient")}</TableHead>
                  <TableHead>{t("mail.colSubject")}</TableHead>
                  <TableHead>{t("mail.colStatus")}</TableHead>
                  <TableHead className="text-right">{t("mail.colWhen")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {messages.map((m) => {
                  const inbound = m.direction === "INBOUND";
                  const cc = parseList(m.cc);
                  const note = parseInboundLogNote(m.error);
                  return (
                  <TableRow key={m.id}>
                    <TableCell className="whitespace-nowrap text-sm">
                      <div className="flex items-center gap-1.5 font-medium">
                        {inbound ? (
                          <ArrowDownLeft className="size-3.5 text-primary" />
                        ) : (
                          <ArrowUpRight className="size-3.5 text-emerald-500" />
                        )}
                        {inbound ? (m.fromName ?? m.fromEmail ?? "—") : (m.toName ?? m.toEmail)}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {inbound ? m.fromEmail : m.toEmail}
                      </div>
                      {cc.length > 0 ? (
                        <div className="text-xs text-muted-foreground">{t("mail.cc")} {cc.join(", ")}</div>
                      ) : null}
                    </TableCell>
                    <TableCell className="max-w-[420px]">
                      <div className="truncate text-sm">{m.subject}</div>
                      <div className="truncate text-xs text-muted-foreground">
                        {m.body.split("\n").find((l) => l.trim()) ?? ""}
                      </div>
                    </TableCell>
                    <TableCell>
                      <StatusBadge map={statusMeta} value={m.status} />
                      {inbound && note ? (
                        <div className="mt-1 max-w-[220px] text-xs text-muted-foreground">
                          {note.kind === "reason"
                            ? t.dyn(`mail.reason.${note.reason}`)
                            : t("mail.skippedAttachments", { names: note.filenames })}
                        </div>
                      ) : null}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-right text-xs text-muted-foreground">
                      {f.relative(m.createdAt)}
                    </TableCell>
                  </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </PageBody>
    </>
  );
}
