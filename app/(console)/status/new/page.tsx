import type { Metadata } from "next";
import { ArrowLeft, Activity } from "lucide-react";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/session";
import { getParam, type SearchParams } from "@/lib/query";
import { canPublishStatusIncident } from "@/lib/status-rules";
import { listLinkableTickets } from "@/lib/status-incidents";
import { PageHeader, PageBody } from "@/components/page-header";
import { LinkButton } from "@/components/link-button";
import { IncidentForm } from "@/components/status/incident-form";
import { getT } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT("status");
  return { title: t("newTitle") };
}
export const dynamic = "force-dynamic";

export default async function NewStatusIncidentPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const me = await requireRole("AGENT");
  const [t, tc] = await Promise.all([getT("status"), getT("common")]);
  const [sp, services, tickets] = await Promise.all([
    searchParams,
    db.service.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
    listLinkableTickets(me),
  ]);

  return (
    <>
      <PageHeader icon={Activity} title={t("newTitle")} description={t("newDescription")}>
        <LinkButton href="/status" variant="outline">
          <ArrowLeft className="size-4" /> {tc("back")}
        </LinkButton>
      </PageHeader>
      <PageBody>
        <div className="max-w-2xl rounded-xl border bg-card p-4 sm:p-6">
          <IncidentForm
            services={services}
            tickets={tickets}
            canPublish={canPublishStatusIncident(me.role)}
            defaultTicketId={getParam(sp, "ticket")}
          />
        </div>
      </PageBody>
    </>
  );
}
