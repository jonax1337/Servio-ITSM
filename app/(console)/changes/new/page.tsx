import type { Metadata } from "next";
import { GitPullRequestArrow } from "lucide-react";
import { db } from "@/lib/db";
import { getFormOptions } from "@/lib/data/options";
import { requireUser } from "@/lib/session";
import { PageHeader, PageBody } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { ChangeForm } from "@/components/changes/change-form";
import type { CustomFieldDef } from "@/lib/custom-fields";

export const metadata: Metadata = { title: "New change" };
export const dynamic = "force-dynamic";

export default async function NewChangePage() {
  const me = await requireUser();
  const [options, customFieldDefs] = await Promise.all([
    getFormOptions(),
    db.customFieldDef.findMany({
      where: { entityType: "CHANGE", active: true },
      orderBy: { order: "asc" },
    }),
  ]);

  return (
    <>
      <PageHeader
        icon={GitPullRequestArrow}
        title="New change"
        description="Raise a change request for review and approval."
      />
      <PageBody>
        <Card className="mx-auto max-w-3xl">
          <CardContent>
            <ChangeForm options={options} currentUserId={me.id} customFieldDefs={customFieldDefs as CustomFieldDef[]} />
          </CardContent>
        </Card>
      </PageBody>
    </>
  );
}
