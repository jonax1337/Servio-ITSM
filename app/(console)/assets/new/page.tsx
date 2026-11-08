import type { Metadata } from "next";
import { HardDrive } from "lucide-react";
import { db } from "@/lib/db";
import { getFormOptions } from "@/lib/data/options";
import { requireUser } from "@/lib/session";
import { PageHeader, PageBody } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { AssetForm } from "@/components/assets/asset-form";
import { getT } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT("assets");
  return { title: t("new.title") };
}
export const dynamic = "force-dynamic";

export default async function NewAssetPage() {
  await requireUser();
  const t = await getT("assets");
  const [options, locations] = await Promise.all([
    getFormOptions(),
    db.location.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);

  return (
    <>
      <PageHeader
        icon={HardDrive}
        title={t("new.title")}
        description={t("new.description")}
      />
      <PageBody>
        <Card className="mx-auto max-w-3xl">
          <CardContent>
            <AssetForm options={options} locations={locations.map((l) => ({ value: l.id, label: l.name }))} />
          </CardContent>
        </Card>
      </PageBody>
    </>
  );
}
