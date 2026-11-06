import { EntityApprovals } from "@/components/approvals/entity-approvals";
import { getEntityApprovals } from "@/lib/data/approvals";
import type { FormOptions } from "@/lib/data/options";
import type { TicketViewer } from "./ticket-tabs";

/** Approvals tab (agents only): ad-hoc sign-off requests. Loads its own data. */
export async function ApprovalsTab({
  ticket, viewer, agents,
}: {
  ticket: { id: number; title: string };
  viewer: TicketViewer;
  agents: FormOptions["agents"];
}) {
  const approvals = await getEntityApprovals("TICKET", ticket.id);
  return (
    <EntityApprovals
      entityType="TICKET"
      entityId={String(ticket.id)}
      entityTitle={ticket.title}
      approvals={approvals}
      currentUserId={viewer.id ?? ""}
      isAdmin={viewer.isAdmin}
      canManage={viewer.canManage}
      canRequest={viewer.isAgent}
      agents={agents}
    />
  );
}
