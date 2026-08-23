import type { Metadata } from "next";
import { Ticket as TicketIcon } from "lucide-react";
import { db } from "@/lib/db";
import { getFormOptions } from "@/lib/data/options";
import { requireUser } from "@/lib/session";
import { PageHeader, PageBody } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { TicketForm } from "@/components/tickets/ticket-form";
import type { CustomFieldDef } from "@/lib/custom-fields";

export const metadata: Metadata = { title: "New ticket" };
export const dynamic = "force-dynamic";

export default async function NewTicketPage() {
  const me = await requireUser();
  const [options, requesters, customFieldDefs] = await Promise.all([
    getFormOptions(),
    db.user.findMany({
      where: { isActive: true },
      select: { id: true, name: true, email: true },
      orderBy: { name: "asc" },
    }),
    db.customFieldDef.findMany({
      where: { entityType: "TICKET", active: true },
      orderBy: { order: "asc" },
    }),
  ]);

  return (
    <>
      <PageHeader
        icon={TicketIcon}
        title="New ticket"
        description="Log a new incident or service request."
      />
      <PageBody>
        <Card className="mx-auto max-w-3xl">
          <CardContent>
            <TicketForm options={options} requesters={requesters} currentUserId={me.id} customFieldDefs={customFieldDefs as CustomFieldDef[]} />
          </CardContent>
        </Card>
      </PageBody>
    </>
  );
}
