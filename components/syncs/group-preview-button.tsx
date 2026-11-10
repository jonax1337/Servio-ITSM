"use client";

import { useState, useTransition } from "react";
import { Loader2, TriangleAlert, Users } from "lucide-react";
import { previewGroupMembership } from "@/lib/actions/syncs";
import type { GroupSyncReport } from "@/lib/connectors/group-sync";
import type { PlannedUser } from "@/lib/connectors/group-plan";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useServerMessage, useT } from "@/lib/i18n/client";

type Result = { ok: true; report: GroupSyncReport } | { ok: false; message: string };

/**
 * "Preview group membership" of a directory sync source: reads the directory and shows which users the next run
 * would add to and remove from which Servio groups. Nothing is written.
 */
export function GroupPreviewButton({ sourceId }: { sourceId: string }) {
  const t = useT("syncs");
  const tm = useServerMessage();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [result, setResult] = useState<Result | null>(null);

  function load() {
    setOpen(true);
    setResult(null);
    start(async () => {
      const fd = new FormData();
      fd.set("sourceId", sourceId);
      setResult(await previewGroupMembership(fd));
    });
  }

  return (
    <>
      <Button type="button" size="sm" variant="outline" onClick={load} disabled={pending}>
        {pending ? <Loader2 className="size-4 animate-spin" /> : <Users className="size-4" />}
        {t("preview.button")}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t("preview.title")}</DialogTitle>
            <DialogDescription>{t("preview.description")}</DialogDescription>
          </DialogHeader>
          {result === null ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> {t("preview.loading")}
            </p>
          ) : !result.ok ? (
            <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{tm(result.message)}</p>
          ) : (
            <Report report={result.report} />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

function Report({ report }: { report: GroupSyncReport }) {
  const t = useT("syncs");
  const tm = useServerMessage();
  const changes = report.groups.reduce((n, g) => n + g.adds.length + g.removes.length, 0);
  return (
    <div className="grid gap-4">
      {report.problems.length > 0 ? (
        <div className="grid gap-1 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-300">
          <p className="flex items-center gap-2 font-medium">
            <TriangleAlert className="size-3.5 shrink-0" /> {t("preview.problems", { count: report.problems.length })}
          </p>
          <ul className="list-disc pl-5">
            {report.problems.map((p) => (
              <li key={p}>{tm(p)}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {changes === 0 ? <p className="text-sm text-muted-foreground">{t("preview.nothing")}</p> : null}
      {report.groups.map((g) => (
        <section key={g.groupId} className="grid gap-2 rounded-lg border p-3">
          <div>
            <h3 className="text-sm font-semibold">{g.groupName}</h3>
            <p className="font-mono text-[11px] text-muted-foreground">{g.directoryGroups.join(", ")}</p>
          </div>
          <UserList label={t("preview.add", { count: g.adds.length })} users={g.adds} sign="+" tone="text-emerald-600 dark:text-emerald-400" />
          <UserList label={t("preview.remove", { count: g.removes.length })} users={g.removes} sign="−" tone="text-red-600 dark:text-red-400" />
          {g.heldBack > 0 ? <p className="text-xs text-amber-700 dark:text-amber-300">{t("preview.heldBack", { count: g.heldBack })}</p> : null}
          {g.pendingNew > 0 ? <p className="text-xs text-muted-foreground">{t("preview.pending", { count: g.pendingNew })}</p> : null}
        </section>
      ))}
    </div>
  );
}

function UserList({ label, users, sign, tone }: { label: string; users: PlannedUser[]; sign: string; tone: string }) {
  if (users.length === 0) return null;
  return (
    <div className="grid gap-1">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <ul className="grid gap-0.5 text-sm">
        {users.map((u) => (
          <li key={u.userId} className="flex items-baseline gap-2">
            <span className={`w-3 shrink-0 text-center font-mono ${tone}`}>{sign}</span>
            <span className="truncate">{u.name ?? u.email}</span>
            {u.name ? <span className="truncate text-xs text-muted-foreground">{u.email}</span> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
