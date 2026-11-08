import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import { ArrowLeft, ExternalLink, Eye, EyeOff, FilePen, Trash2 } from "lucide-react";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/session";
import { canPublishStatusIncident } from "@/lib/status-rules";
import { listLinkableTickets } from "@/lib/status-incidents";
import { deleteStatusIncident, setStatusIncidentVisibility } from "@/lib/actions/status-incidents";
import { LinkButton } from "@/components/link-button";
import { ConfirmButton } from "@/components/confirm-dialog";
import { StatusBadge } from "@/components/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { IncidentTimeline } from "@/components/status/incident-timeline";
import { PostUpdateForm } from "@/components/status/post-update-form";
import { EditIncidentDialog } from "@/components/status/edit-incident-dialog";
import { VisibilityBadge } from "@/components/status/visibility-badge";
import {
  STATUS_INCIDENT_IMPACT_META,
  STATUS_INCIDENT_STATE_META,
  TONE_BANNER_CLASSES,
  TONE_TEXT_CLASSES,
  ticketRef,
} from "@/lib/constants";
import { getFormatter, getT } from "@/lib/i18n/server";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const incident = await db.statusIncident.findUnique({ where: { id }, select: { title: true } });
  const t = await getT("status");
  return { title: incident ? incident.title : t("statusIncident") };
}

/** Delete, then leave the (now missing) detail page. */
async function removeIncident(formData: FormData) {
  "use server";
  const result = await deleteStatusIncident(formData);
  if (result.ok) redirect("/status");
  return result;
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1">
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="text-sm">{children}</dd>
    </div>
  );
}

export default async function StatusIncidentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await requireRole("AGENT");
  const [incident, allServices] = await Promise.all([
    db.statusIncident.findUnique({
      where: { id },
      include: {
        services: { select: { serviceId: true, service: { select: { name: true } } } },
        updates: { orderBy: { createdAt: "desc" }, include: { author: { select: { name: true, email: true } } } },
        ticket: { select: { id: true, type: true, prefix: true, title: true } },
      },
    }),
    db.service.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  if (!incident) notFound();
  const [t, tc, f] = await Promise.all([getT("status"), getT("common"), getFormatter()]);
  const when = (date: Date | null) =>
    date ? f.pattern(date, f.locale === "de" ? "d. MMM yyyy, HH:mm" : "MMM d, yyyy HH:mm") : t("notYet");
  const tickets = await listLinkableTickets(me, incident.ticketId);
  const canPublish = canPublishStatusIncident(me.role);

  const retract = (
    <ConfirmButton
      action={setStatusIncidentVisibility}
      fields={{ incidentId: incident.id, isPublic: "false" }}
      title={t("retractTitle")}
      description={t("retractDescription")}
      confirmLabel={t("retract")}
      confirmVariant="default"
      triggerVariant="outline"
      triggerSize="sm"
      successMessage={t("retracted")}
    >
      <EyeOff className="size-4" /> {t("retract")}
    </ConfirmButton>
  );
  const publish = (
    <ConfirmButton
      action={setStatusIncidentVisibility}
      fields={{ incidentId: incident.id, isPublic: "true" }}
      title={t("publishTitle")}
      description={t("publishDescription")}
      confirmLabel={t("publish")}
      confirmVariant="default"
      triggerVariant="default"
      triggerSize="sm"
      successMessage={t("publishedToast")}
    >
      <Eye className="size-4" /> {t("publish")}
    </ConfirmButton>
  );

  return (
    <div data-viewport-pane className="grid gap-0 lg:h-full lg:grid-cols-[1fr_320px] lg:overflow-hidden">
      {/* Main column: scrolls independently from the properties rail */}
      <div className="min-w-0 border-b lg:min-h-0 lg:overflow-y-auto lg:border-b-0 lg:border-r">
        <div className="flex flex-wrap items-center gap-3 border-b px-4 py-3 sm:px-6">
          <LinkButton href="/status" variant="ghost" size="icon-sm" aria-label={t("backToIncidents")}>
            <ArrowLeft className="size-4" />
          </LinkButton>
          <VisibilityBadge isPublic={incident.isPublic} />
          <StatusBadge map={STATUS_INCIDENT_STATE_META} value={incident.state} />
          <StatusBadge map={STATUS_INCIDENT_IMPACT_META} value={incident.impact} dot={false} />
          <div className="ml-auto flex items-center gap-2">
            <EditIncidentDialog
              services={allServices}
              tickets={tickets}
              copyLocked={incident.isPublic && !canPublish}
              incident={{
                id: incident.id,
                title: incident.title,
                summary: incident.summary,
                impact: incident.impact,
                ticketId: incident.ticketId,
                serviceIds: incident.services.map((s) => s.serviceId),
              }}
            />
            {canPublish ? (
              <ConfirmButton
                action={removeIncident}
                fields={{ incidentId: incident.id }}
                title={t("deleteTitle")}
                description={t("deleteDescription")}
                triggerLabel={t("deleteIncident")}
              >
                <Trash2 className="size-4" />
              </ConfirmButton>
            ) : null}
          </div>
        </div>

        {incident.isPublic ? (
          <div className={`flex flex-wrap items-center gap-x-3 gap-y-2 border-b px-4 py-2.5 text-sm sm:px-6 ${TONE_BANNER_CLASSES.info}`}>
            <Eye className={`size-4 ${TONE_TEXT_CLASSES.info}`} />
            <span className="font-medium">{t("public")}</span>
            <span className="text-muted-foreground">
              {incident.publishedAt ? t("publicNoticeSince", { date: when(incident.publishedAt) }) : t("publicNotice")}
            </span>
            <Link href="/portal/status" className="inline-flex items-center gap-1 text-primary hover:underline">
              {t("portalStatusPage")} <ExternalLink className="size-3.5" />
            </Link>
            {canPublish ? <span className="ml-auto">{retract}</span> : null}
          </div>
        ) : (
          <div className={`flex flex-wrap items-center gap-x-3 gap-y-2 border-b px-4 py-2.5 text-sm sm:px-6 ${TONE_BANNER_CLASSES.warning}`}>
            <FilePen className={`size-4 ${TONE_TEXT_CLASSES.warning}`} />
            <span className="font-medium">{t("draft")}</span>
            <span className="text-muted-foreground">
              {t("draftNotice")}
            </span>
            <span className="ml-auto">
              {canPublish ? publish : <span className="text-muted-foreground">{t("managerPublishes")}</span>}
            </span>
          </div>
        )}

        <div className="grid gap-6 p-4 sm:p-6">
          <div>
            <h1 className="font-display text-2xl font-semibold tracking-tight">{incident.title}</h1>
            {incident.summary ? (
              <p className="mt-1 text-sm text-muted-foreground">{incident.summary}</p>
            ) : (
              <p className="mt-1 text-sm text-muted-foreground">
                {t("noSummary")}
              </p>
            )}
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm">{t("postUpdate")}</CardTitle>
            </CardHeader>
            <CardContent>
              <PostUpdateForm incidentId={incident.id} currentState={incident.state} isPublic={incident.isPublic} />
            </CardContent>
          </Card>

          <section className="grid gap-4">
            <h2 className="text-sm font-medium">{t("timeline")}</h2>
            <IncidentTimeline
              updates={incident.updates.map((u) => ({
                id: u.id,
                state: u.state,
                body: u.body,
                createdAt: u.createdAt,
                author: u.author ? (u.author.name ?? u.author.email) : null,
              }))}
            />
          </section>
        </div>
      </div>

      <aside className="p-4 sm:p-6 lg:min-h-0 lg:overflow-y-auto">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">{tc("properties")}</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid gap-4">
              <Fact label={t("visibility")}>
                <VisibilityBadge isPublic={incident.isPublic} />
              </Fact>
              <Fact label={t("state")}>
                <StatusBadge map={STATUS_INCIDENT_STATE_META} value={incident.state} />
              </Fact>
              <Fact label={tc("impact")}>
                <StatusBadge map={STATUS_INCIDENT_IMPACT_META} value={incident.impact} dot={false} />
              </Fact>
              <Fact label={t("affectedServices")}>
                {incident.services.length > 0 ? incident.services.map((s) => s.service.name).join(", ") : tc("none")}
              </Fact>
              <Fact label={t("linkedTicket")}>
                {incident.ticket ? (
                  <Link href={`/tickets/${incident.ticket.id}`} className="hover:text-primary">
                    <span className="font-mono text-xs">{ticketRef(incident.ticket.id, incident.ticket.prefix || incident.ticket.type)}</span>
                    <span className="block text-muted-foreground">{incident.ticket.title}</span>
                  </Link>
                ) : (
                  tc("none")
                )}
              </Fact>
              <Fact label={t("started")}>{when(incident.startedAt)}</Fact>
              <Fact label={t("published")}>{when(incident.publishedAt)}</Fact>
              <Fact label={t("resolved")}>{when(incident.resolvedAt)}</Fact>
            </dl>
          </CardContent>
        </Card>
      </aside>
    </div>
  );
}
