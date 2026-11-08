import type { Metadata } from "next";
import { db } from "@/lib/db";
import { PORTAL_CATEGORY_WHERE } from "@/lib/categories";
import { requireUser } from "@/lib/session";
import { Card, CardContent } from "@/components/ui/card";
import { RequestForm } from "@/components/portal/request-form";
import { PublicIncidentCard } from "@/components/status/public-incident-card";
import { listPublicIncidents } from "@/lib/status-incidents";
import { getMaxUploadMb } from "@/lib/settings";
import type { SearchParams } from "@/lib/query";
import { getParam } from "@/lib/query";
import { getT } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT("portal");
  return { title: t("newRequestTitle") };
}
export const dynamic = "force-dynamic";

export default async function PortalNewPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const user = await requireUser();
  const sp = await searchParams;
  const maxUploadMb = await getMaxUploadMb();
  const t = await getT("portal");
  const [activeIncidents, categories, services] = await Promise.all([
    listPublicIncidents(user.id, "active", 5),
    db.category.findMany({
      where: PORTAL_CATEGORY_WHERE,
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    db.service.findMany({
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-6">
        <h1 className="font-display text-2xl font-semibold tracking-tight sm:text-3xl">{t("submitRequestHeading")}</h1>
        <p className="mt-1 text-muted-foreground">
          {t("submitRequestText")}
        </p>
      </div>
      {activeIncidents.length > 0 ? (
        <section aria-labelledby="known-issues" className="mb-6 grid gap-3">
          <div>
            <h2 id="known-issues" className="font-medium">
              {t("knownIssues")}
            </h2>
            <p className="text-sm text-muted-foreground">
              {t("knownIssuesText")}
            </p>
          </div>
          {activeIncidents.map((incident) => (
            <PublicIncidentCard key={incident.id} incident={incident} variant="compact" />
          ))}
        </section>
      ) : null}
      <Card>
        <CardContent>
          <RequestForm
            categories={categories.map((c) => ({ value: c.id, label: c.name }))}
            services={services.map((s) => ({ value: s.id, label: s.name }))}
            defaultType={getParam(sp, "type") ?? "INCIDENT"}
            defaultService={getParam(sp, "service")}
            maxMb={maxUploadMb}
          />
        </CardContent>
      </Card>
    </div>
  );
}
