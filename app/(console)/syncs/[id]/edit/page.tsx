import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Settings2 } from "lucide-react";
import { requireRole } from "@/lib/session";
import { db } from "@/lib/db";
import { PageHeader, PageBody } from "@/components/page-header";
import { SyncSourceForm } from "@/components/syncs/source-form";
import { configToFormValues } from "@/lib/connectors/spec";
import { getT } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT("syncs");
  return { title: t("editMetaTitle") };
}
export const dynamic = "force-dynamic";

export default async function EditSyncSourcePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireRole("ADMIN");
  const t = await getT("syncs");
  const { id } = await params;

  const source = await db.syncSource.findUnique({ where: { id } });
  if (!source) notFound();

  const { values, passwordSet } = configToFormValues(source.type, source.scope, source.config);

  return (
    <>
      <PageHeader
        icon={Settings2}
        title={t("editTitle", { name: source.name })}
        description={t("editDescription")}
      />
      <PageBody>
        <SyncSourceForm
          mode="edit"
          source={{
            id: source.id,
            name: source.name,
            type: source.type,
            schedule: source.schedule,
            scope: source.scope,
          }}
          values={values}
          passwordSet={passwordSet}
        />
      </PageBody>
    </>
  );
}
