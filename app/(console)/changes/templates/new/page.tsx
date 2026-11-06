import type { Metadata } from "next";
import { FileStack } from "lucide-react";
import { getFormOptions } from "@/lib/data/options";
import { requireRole } from "@/lib/session";
import { PageHeader, PageBody } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { TemplateForm } from "@/components/changes/templates/template-form";

export const metadata: Metadata = { title: "New change template" };
export const dynamic = "force-dynamic";

export default async function NewChangeTemplatePage() {
  await requireRole("MANAGER");
  const options = await getFormOptions();

  return (
    <>
      <PageHeader
        icon={FileStack}
        title="New change template"
        description="Define the prefilled values for a repeatable change."
      />
      <PageBody>
        <Card className="mx-auto max-w-3xl">
          <CardContent>
            <TemplateForm options={options} />
          </CardContent>
        </Card>
      </PageBody>
    </>
  );
}
