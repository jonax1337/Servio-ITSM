import type { Metadata } from "next";
import { HardDrive } from "lucide-react";
import { db } from "@/lib/db";
import { getFormOptions } from "@/lib/data/options";
import { requireUser } from "@/lib/session";
import { PageHeader, PageBody } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { AssetForm } from "@/components/assets/asset-form";

export const metadata: Metadata = { title: "New asset" };
export const dynamic = "force-dynamic";

export default async function NewAssetPage() {
  await requireUser();
  const [options, locations] = await Promise.all([
    getFormOptions(),
    db.location.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);

  return (
    <>
      <PageHeader
        icon={HardDrive}
        title="New asset"
        description="Register a new configuration item in the CMDB."
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
