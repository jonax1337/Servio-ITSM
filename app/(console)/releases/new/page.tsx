import type { Metadata } from "next";
import { Rocket } from "lucide-react";
import { getFormOptions } from "@/lib/data/options";
import { requireUser } from "@/lib/session";
import { PageHeader, PageBody } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { ReleaseForm } from "@/components/releases/release-form";
import { getT } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT("releases");
  return { title: t("new.title") };
}
export const dynamic = "force-dynamic";

export default async function NewReleasePage() {
  const [me, options, t] = await Promise.all([requireUser(), getFormOptions(), getT("releases")]);

  return (
    <>
      <PageHeader icon={Rocket} title={t("new.title")} description={t("new.description")} />
      <PageBody>
        <Card className="mx-auto max-w-3xl">
          <CardContent>
            <ReleaseForm options={options} defaultOwnerId={me.id} />
          </CardContent>
        </Card>
      </PageBody>
    </>
  );
}
