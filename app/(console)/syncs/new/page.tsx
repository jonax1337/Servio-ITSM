import type { Metadata } from "next";
import { RefreshCw } from "lucide-react";
import { requireRole } from "@/lib/session";
import { PageHeader, PageBody } from "@/components/page-header";
import { SyncSourceForm } from "@/components/syncs/source-form";
import { getT } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT("syncs");
  return { title: t("newMetaTitle") };
}
export const dynamic = "force-dynamic";

export default async function NewSyncSourcePage() {
  await requireRole("ADMIN");
  const t = await getT("syncs");

  return (
    <>
      <PageHeader
        icon={RefreshCw}
        title={t("newTitle")}
        description={t("newDescription")}
      />
      <PageBody>
        <SyncSourceForm mode="create" />
      </PageBody>
    </>
  );
}
