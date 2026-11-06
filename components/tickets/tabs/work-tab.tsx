import { db } from "@/lib/db";
import { TicketTasks } from "@/components/tickets/ticket-tasks";
import { WorkLog } from "@/components/tickets/work-log";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { TicketViewer } from "./ticket-tabs";

/** Work tab (agents only): the task checklist and the logged time. Loads its own data. */
export async function WorkTab({ ticketId, viewer }: { ticketId: number; viewer: TicketViewer }) {
  const [tasks, worklogs] = await Promise.all([
    db.task.findMany({ where: { ticketId }, orderBy: { createdAt: "asc" } }),
    db.workLog.findMany({ where: { ticketId }, include: { user: true }, orderBy: { loggedAt: "desc" } }),
  ]);

  // WorkLog carries its own top margin, so the cards are stacked without a grid gap.
  return (
    <div>
      <Card>
        <CardHeader><CardTitle className="text-sm">Tasks</CardTitle></CardHeader>
        <CardContent>
          <TicketTasks ticketId={ticketId} tasks={tasks} />
        </CardContent>
      </Card>
      <WorkLog ticketId={ticketId} logs={worklogs} meId={viewer.id ?? ""} isAdmin={viewer.isAdmin} />
    </div>
  );
}
