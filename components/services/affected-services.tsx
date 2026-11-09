import Link from "next/link";
import { LifeBuoy } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { metaFor, SERVICE_STATUS_META, TONE_CLASSES } from "@/lib/constants";
import { serviceLabel } from "@/lib/service-label";
import { changeAffectedServices, problemAffectedServices, ticketAffectedServices, type ServiceImpactRow } from "@/lib/service-graph";
import { getT } from "@/lib/i18n/server";
import { cn } from "@/lib/utils";

/**
 * Read-only badge list of the services a record's CIs affect (tickets, problems,
 * changes). Solid badges run directly on a linked CI; dashed ones are hit
 * indirectly, through a CI it takes down or a service dependency.
 */
export async function AffectedServicesCard({ rows, className }: { rows: ServiceImpactRow[]; className?: string }) {
  const t = await getT("services");
  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <LifeBuoy className="size-4 text-muted-foreground" />
          {t("affected.heading", { count: rows.length })}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("affected.none")}</p>
        ) : (
          <>
            <div className="flex flex-wrap gap-1.5">
              {rows.map((r) => {
                const tone = metaFor(SERVICE_STATUS_META, r.status).tone;
                const why = r.via
                  ? r.via.kind === "asset"
                    ? t("impact.viaAsset", { name: r.via.name })
                    : t("impact.viaService", { name: r.via.name })
                  : undefined;
                return (
                  <Link
                    key={r.id}
                    href={`/services/${r.id}`}
                    title={why}
                    className={cn(
                      "inline-flex max-w-full items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-medium hover:border-primary/60",
                      TONE_CLASSES[tone],
                      !r.direct && "border-dashed bg-transparent",
                    )}
                  >
                    <span className="size-1.5 shrink-0 rounded-full bg-current opacity-80" />
                    <span className="truncate">{serviceLabel(r)}</span>
                  </Link>
                );
              })}
            </div>
            {rows.some((r) => !r.direct) ? <p className="mt-2 text-xs text-muted-foreground">{t("affected.legend")}</p> : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}

/** The affected-services card of a ticket, change or problem, loading its own data. */
export async function RecordAffectedServices({ record, className }: { record: { kind: "ticket" | "change" | "problem"; id: number }; className?: string }) {
  const rows =
    record.kind === "ticket"
      ? await ticketAffectedServices(record.id)
      : record.kind === "change"
        ? await changeAffectedServices(record.id)
        : await problemAffectedServices(record.id);
  return <AffectedServicesCard rows={rows} className={className} />;
}
