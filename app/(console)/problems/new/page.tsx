import type { Metadata } from "next";
import { AlertTriangle } from "lucide-react";
import { db } from "@/lib/db";
import { getFormOptions } from "@/lib/data/options";
import { requireUser } from "@/lib/session";
import { PageHeader, PageBody } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { ProblemForm } from "@/components/problems/problem-form";
import type { CustomFieldDef } from "@/lib/custom-fields";
import { getT } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT("problems");
  return { title: t("new.title") };
}
export const dynamic = "force-dynamic";

export default async function NewProblemPage() {
  const me = await requireUser();
  const t = await getT("problems");
  const [options, customFieldDefs] = await Promise.all([
    getFormOptions(),
    db.customFieldDef.findMany({
      where: { entityType: "PROBLEM", active: true },
      orderBy: { order: "asc" },
    }),
  ]);

  return (
    <>
      <PageHeader
        icon={AlertTriangle}
        title={t("new.title")}
        description={t("new.description")}
      />
      <PageBody>
        <Card className="mx-auto max-w-3xl">
          <CardContent>
            <ProblemForm options={options} currentUserId={me.id} customFieldDefs={customFieldDefs as CustomFieldDef[]} />
          </CardContent>
        </Card>
      </PageBody>
    </>
  );
}
