import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { ArrowLeft, Clock } from "lucide-react";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { parseFormSchema } from "@/lib/service-forms";
import { CatalogIcon } from "@/components/catalog/catalog-icon";
import { LinkButton } from "@/components/link-button";
import { getMaxUploadMb } from "@/lib/settings";
import { Card, CardContent } from "@/components/ui/card";
import { ServiceRequestForm } from "@/components/portal/service-request-form";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ serviceId: string }>;
}): Promise<Metadata> {
  const { serviceId } = await params;
  const it = await db.catalogItem.findUnique({ where: { id: serviceId }, select: { name: true } });
  return { title: it ? `Request ${it.name}` : "Request" };
}

export default async function CatalogRequestPage({
  params,
}: {
  params: Promise<{ serviceId: string }>;
}) {
  await requireUser();
  const { serviceId } = await params;
  const item = await db.catalogItem.findUnique({ where: { id: serviceId } });
  if (!item || !item.isPublished) notFound();

  const maxUploadMb = await getMaxUploadMb();
  const fields = parseFormSchema(item.formSchema);

  return (
    <div className="mx-auto max-w-2xl">
      <LinkButton href="/portal/catalog" variant="ghost" size="sm" className="mb-4 -ml-2">
        <ArrowLeft className="size-4" /> Back to catalog
      </LinkButton>

      <div className="mb-6 flex items-start gap-3.5">
        <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-primary/10 text-primary">
          <CatalogIcon name={item.icon} className="size-6" />
        </span>
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight">{item.name}</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">{item.description ?? item.shortDescription}</p>
          {item.estimatedDays != null ? (
            <p className="mt-1.5 flex items-center gap-1 text-xs text-muted-foreground">
              <Clock className="size-3.5" /> Usually delivered in ~{item.estimatedDays} day{item.estimatedDays === 1 ? "" : "s"}
            </p>
          ) : null}
        </div>
      </div>

      <Card>
        <CardContent>
          <ServiceRequestForm
            serviceId={item.id}
            fields={fields}
            requiresApproval={item.requiresApproval}
            maxMb={maxUploadMb}
          />
        </CardContent>
      </Card>
    </div>
  );
}
