import Link from "next/link";
import { notFound } from "next/navigation";
import { Users } from "lucide-react";
import { db } from "@/lib/db";
import { AttachmentsCard } from "@/components/attachments/attachments-card";
import { EntityCustomFields } from "@/components/custom-fields/entity-custom-fields";
import { UserAvatar } from "@/components/user-avatar";
import { EmptyState } from "@/components/empty-state";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getMaxUploadMb } from "@/lib/settings";
import { isFieldVisible, parseValues, entityFieldValues, type CustomFieldDef } from "@/lib/custom-fields";
import type { TicketViewer } from "./ticket-tabs";

/** Details tab: attachments, custom fields and participants (form answers sit above the tabs). Loads its own data. */
export async function DetailsTab({ ticketId, viewer }: { ticketId: number; viewer: TicketViewer }) {
  const [ticket, customFieldDefs, maxUploadMb] = await Promise.all([
    db.ticket.findUnique({
      where: { id: ticketId },
      include: {
        participants: { include: { user: true }, orderBy: { createdAt: "asc" } },
        attachments: { orderBy: { createdAt: "desc" } },
      },
    }),
    db.customFieldDef.findMany({ where: { entityType: "TICKET", active: true }, orderBy: { order: "asc" } }),
    getMaxUploadMb(),
  ]);
  if (!ticket) notFound();

  // Keep only defs whose visibility matches this ticket's built-in fields.
  const visibleCustomFields = (customFieldDefs as CustomFieldDef[]).filter((def) =>
    isFieldVisible(def, entityFieldValues(ticket)),
  );
  const hasContent =
    ticket.attachments.length > 0 || visibleCustomFields.length > 0 || ticket.participants.length > 0;

  if (!hasContent) {
    return <EmptyState title="No further details" description="Attachments, custom fields and portal participants appear here." />;
  }

  return (
    <div className="grid gap-4">
      {ticket.attachments.length > 0 ? (
        <AttachmentsCard
          attachments={ticket.attachments}
          target={{ ticketId: ticket.id }}
          canUpload={false}
          canDeleteAll={viewer.isAgent}
          currentUserId={viewer.id}
          maxMb={maxUploadMb}
        />
      ) : null}

      <EntityCustomFields
        entityType="TICKET"
        entityId={ticket.id}
        defs={visibleCustomFields}
        values={parseValues(ticket.customFields)}
        editable={viewer.isAgent}
      />

      {/* Participants: portal-visible collaborators (e.g. a CC'd manager). */}
      {ticket.participants.length > 0 ? (
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-1.5 text-sm"><Users className="size-4 text-muted-foreground" /> Participants</CardTitle></CardHeader>
          <CardContent className="grid gap-1.5">
            <div className="text-xs text-muted-foreground">Can see &amp; reply in the portal</div>
            {ticket.participants.map((p) => (
              <Link
                key={p.userId}
                href={`/people/${p.userId}`}
                className="group flex items-center gap-2.5 rounded-lg border p-2 transition-colors hover:border-primary/40"
              >
                <UserAvatar name={p.user.name} email={p.user.email} image={p.user.image} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium group-hover:text-primary">{p.user.name ?? p.user.email}</span>
                  <span className="block truncate text-xs text-muted-foreground">{p.user.email}</span>
                </span>
              </Link>
            ))}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
