import { Clock, Trash2 } from "lucide-react";
import { deleteWorkLog } from "@/lib/actions/tickets";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmButton } from "@/components/confirm-dialog";
import { LogTimePopover } from "@/components/tickets/log-time-popover";
import { formatMinutes } from "@/lib/utils";
import { getFormatter, getT } from "@/lib/i18n/server";

type Log = {
  id: string;
  minutes: number;
  note: string | null;
  billable: boolean;
  loggedAt: Date;
  userId: string;
  user: { name: string | null; email: string };
};

/** Server Component. */
export async function WorkLog({
  ticketId, logs, meId, isAdmin,
}: {
  ticketId: number;
  logs: Log[];
  meId: string;
  isAdmin: boolean;
}) {
  const total = logs.reduce((s, l) => s + l.minutes, 0);
  const [t, f] = await Promise.all([getT("tickets"), getFormatter()]);

  return (
    <Card className="mt-4">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          {t("work.timeLogged")}
          {total > 0 ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
              <Clock className="size-3" /> {formatMinutes(total)}
            </span>
          ) : null}
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3">
        {logs.length > 0 ? (
          <ul className="grid gap-2">
            {logs.map((l) => (
              <li key={l.id} className="group rounded-lg border px-3 py-2">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium tabular-nums">{formatMinutes(l.minutes)}</span>
                  {l.billable ? (
                    <span className="rounded bg-emerald-500/10 px-1 text-[10px] font-medium text-emerald-600 dark:text-emerald-400">{t("work.billableBadge")}</span>
                  ) : null}
                  <span className="ml-auto truncate text-xs text-muted-foreground">
                    {l.user.name ?? l.user.email} · {f.date(l.loggedAt, "dateShort")}
                  </span>
                  {l.userId === meId || isAdmin ? (
                    <ConfirmButton
                      action={deleteWorkLog}
                      fields={{ logId: l.id }}
                      title={t("work.removeTitle")}
                      description={t("work.removeDescription", { duration: formatMinutes(l.minutes) })}
                      confirmLabel={t("work.remove")}
                      triggerVariant="ghost"
                      triggerSize="icon-xs"
                      triggerClassName="-mr-1 opacity-0 transition-opacity group-hover:opacity-100"
                      triggerLabel={t("work.removeEntry")}
                    >
                      <Trash2 className="size-3.5" />
                    </ConfirmButton>
                  ) : null}
                </div>
                {l.note ? (
                  <p className="mt-1 text-sm text-muted-foreground">{l.note}</p>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">{t("work.none")}</p>
        )}

        <LogTimePopover ticketId={ticketId} />
      </CardContent>
    </Card>
  );
}
