import { db } from "@/lib/db";
import { lowerLead } from "@/lib/utils";
import { History } from "lucide-react";
import { getFormatter, getT } from "@/lib/i18n/server";
import { Msg } from "@/lib/i18n/client";

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
  const [t, f] = await Promise.all([getT("tickets"), getFormatter()]);

  if (logs.length === 0) {
    return <p className="text-sm text-muted-foreground">{t("history.none")}</p>;
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
              <span className="font-medium">{l.user?.name ?? t("history.system")}</span>{" "}
              <span className="text-muted-foreground">{lowerLead(l.summary ?? l.action)}</span>
            </p>
            <p className="text-xs text-muted-foreground">{f.date(l.createdAt)} · {f.date(l.createdAt, "time")}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}

export function HistoryHeading() {
  return (
    <span className="flex items-center gap-2">
      <History className="size-4 text-muted-foreground" /> <Msg ns="common" k="history" />
    </span>
  );
}
