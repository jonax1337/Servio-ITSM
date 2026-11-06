import { db } from "@/lib/db";
import { lowerLead } from "@/lib/utils";
import { History } from "lucide-react";
import { format } from "date-fns";

/** Reusable change-history timeline for any entity (reads AuditLog). */
export async function EntityHistory({
  entity,
  entityId,
  limit = 50,
}: {
  entity: string;
  entityId: string;
  limit?: number;
}) {
  const logs = await db.auditLog.findMany({
    where: { entity, entityId },
    include: { user: true },
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  if (logs.length === 0) {
    return <p className="text-sm text-muted-foreground">No history recorded yet.</p>;
  }

  return (
    <ol className="relative grid gap-4 before:absolute before:left-[11px] before:top-1 before:h-[calc(100%-1rem)] before:w-px before:bg-border">
      {logs.map((l) => (
        <li key={l.id} className="relative flex gap-3">
          <span className="z-10 grid size-6 shrink-0 place-items-center rounded-full border bg-muted text-[10px] font-semibold">
            {(l.user?.name ?? "S").slice(0, 2).toUpperCase()}
          </span>
          <div className="min-w-0 pt-0.5">
            <p className="text-sm">
              <span className="font-medium">{l.user?.name ?? "System"}</span>{" "}
              <span className="text-muted-foreground">{lowerLead(l.summary ?? l.action)}</span>
            </p>
            <p className="text-xs text-muted-foreground">{format(l.createdAt, "PP · p")}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}

export function HistoryHeading() {
  return (
    <span className="flex items-center gap-2">
      <History className="size-4 text-muted-foreground" /> History
    </span>
  );
}
