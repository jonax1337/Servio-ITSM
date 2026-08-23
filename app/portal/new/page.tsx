import type { Metadata } from "next";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { Card, CardContent } from "@/components/ui/card";
import { RequestForm } from "@/components/portal/request-form";
import { getMaxUploadMb } from "@/lib/settings";
import type { SearchParams } from "@/lib/query";
import { getParam } from "@/lib/query";

export const metadata: Metadata = { title: "New request" };
export const dynamic = "force-dynamic";

export default async function PortalNewPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requireUser();
  const sp = await searchParams;
  const maxUploadMb = await getMaxUploadMb();
  const [categories, services] = await Promise.all([
    db.category.findMany({
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
        <h1 className="font-display text-2xl font-semibold tracking-tight sm:text-3xl">Submit a request</h1>
        <p className="mt-1 text-muted-foreground">
          Tell us what you need and we&apos;ll route it to the right team. The more detail, the faster we can help.
        </p>
      </div>
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
