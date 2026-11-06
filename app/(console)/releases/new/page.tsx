import type { Metadata } from "next";
import { Rocket } from "lucide-react";
import { getFormOptions } from "@/lib/data/options";
import { requireUser } from "@/lib/session";
import { PageHeader, PageBody } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { ReleaseForm } from "@/components/releases/release-form";

export const metadata: Metadata = { title: "New release" };
export const dynamic = "force-dynamic";

export default async function NewReleasePage() {
  const [me, options] = await Promise.all([requireUser(), getFormOptions()]);

  return (
    <>
      <PageHeader icon={Rocket} title="New release" description="Create a release, then bundle the changes that ship in it." />
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
