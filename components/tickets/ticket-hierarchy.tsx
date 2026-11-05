import { Network } from "lucide-react";
import { setTicketParent } from "@/lib/actions/tickets";
import { LinkPicker } from "@/components/link-picker";
import { LinkedChip, UnlinkButton } from "@/components/linked-records";
import { StatusBadge } from "@/components/status-badge";
import { TICKET_STATUS_META, ticketRef } from "@/lib/constants";
import type { ComboOption } from "@/components/combobox";

type RelatedTicket = { id: number; title: string; prefix: string; status: string };

const chipLabel = (t: RelatedTicket) => `${ticketRef(t.id, t.prefix)} · ${t.title}`;

/**
 * The ticket's place in a parent / child hierarchy: its parent (with unlink), its
 * child tickets with their status, and pickers to set the parent or add a child.
 * `parentOptions` / `childOptions` are the tickets an agent may choose from.
 */
export function TicketHierarchy({
  ticketId, parent, childTickets, parentOptions, childOptions, canEdit,
}: {
  ticketId: number;
  parent: RelatedTicket | null;
  childTickets: RelatedTicket[];
  parentOptions: ComboOption[];
  childOptions: ComboOption[];
  canEdit: boolean;
}) {
  if (!canEdit && !parent && childTickets.length === 0) return null;

  return (
    <div className="mt-6">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <Network className="size-4 text-muted-foreground" /> Parent / child tickets
        </h2>
        {canEdit ? (
          <div className="flex flex-wrap items-center gap-1.5">
            <LinkPicker
              action={setTicketParent}
              triggerLabel={parent ? "Change parent" : "Parent"}
              title="Set parent ticket"
              description="Group this ticket under a bigger ticket, e.g. a major incident."
              hidden={{ ticketId }}
              valueName="parentId"
              options={parentOptions}
              placeholder="Choose a parent ticket"
              searchPlaceholder="Search tickets…"
              emptyText="No open tickets to use as a parent."
              successMessage="Parent set"
            />
            <LinkPicker
              action={setTicketParent}
              triggerLabel="Add child"
              title="Add child ticket"
              description="Attach another ticket to this one. Resolving this ticket can resolve its open children too."
              hidden={{ parentId: ticketId }}
              valueName="ticketId"
              options={childOptions}
              placeholder="Choose a child ticket"
              searchPlaceholder="Search tickets…"
              emptyText="No tickets available to add as a child."
              successMessage="Child added"
            />
          </div>
        ) : null}
      </div>

      {parent ? (
        <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span>Parent</span>
          <LinkedChip
            href={`/tickets/${parent.id}`}
            icon={<StatusBadge map={TICKET_STATUS_META} value={parent.status} />}
            label={chipLabel(parent)}
            unlink={canEdit ? <UnlinkButton action={setTicketParent} fields={{ ticketId, parentId: "" }} /> : undefined}
          />
        </div>
      ) : null}

      <h3 className="mb-2 text-xs font-medium text-muted-foreground">Child tickets ({childTickets.length})</h3>
      {childTickets.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {childTickets.map((child) => (
            <LinkedChip
              key={child.id}
              href={`/tickets/${child.id}`}
              icon={<StatusBadge map={TICKET_STATUS_META} value={child.status} />}
              label={chipLabel(child)}
              unlink={canEdit ? <UnlinkButton action={setTicketParent} fields={{ ticketId: child.id, parentId: "" }} /> : undefined}
            />
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">No child tickets.</p>
      )}
    </div>
  );
}
