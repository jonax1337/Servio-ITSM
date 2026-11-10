"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { ArrowUp, ArrowDown, ChevronsUpDown, TriangleAlert, X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { BulkEditDialog, type BulkEditOptions } from "@/components/tickets/bulk-edit-dialog";
import { StatusBadge, ToneBadge, VipBadge } from "@/components/status-badge";
import { UserAvatar } from "@/components/user-avatar";
import { RaiseProblemDialog } from "@/components/tickets/raise-problem-dialog";
import { problemDraftFromTickets } from "@/lib/ticket-drafts";
import { PRIORITY_META, SLA_STATE_META, TICKET_STATUS_META, metaFor, ticketRef } from "@/lib/constants";
import type { SlaCell } from "@/lib/sla-column";
import { LocalTime, timeAgo } from "@/components/local-time";
import { useT } from "@/lib/i18n/client";
import type { Translator } from "@/lib/i18n/translate";

/** "2h 10m" (lib/sla-column compactDuration) in the viewer's units. */
function localizeSpan(span: string, t: Translator<"tickets">): string {
  return span
    .split(" ")
    .map((part) => {
      const m = /^(\d+)([dhm])$/.exec(part);
      if (!m) return part;
      const n = Number(m[1]);
      return m[2] === "d" ? t("sla.days", { n }) : m[2] === "h" ? t("sla.hours", { n }) : t("sla.minutes", { n });
    })
    .join(" ");
}

/** The SLA cell detail ("overdue 3d" / "2h left", built in lib/sla-column) in the viewer's language. */
function localizeSlaDetail(detail: string, t: Translator<"tickets">): string {
  const overdue = /^overdue (.+)$/.exec(detail);
  if (overdue) return t("sla.overdue", { span: localizeSpan(overdue[1], t) });
  const left = /^(.+) left$/.exec(detail);
  if (left) return t("sla.left", { span: localizeSpan(left[1], t) });
  return detail;
}

type Row = {
  id: number;
  prefix: string;
  title: string;
  category: string | null;
  requesterName: string;
  requesterVip: boolean;
  priority: string;
  status: string;
  sla: SlaCell | null;
  assignee: { name: string | null; email: string } | null;
  createdAt: string | Date;
  updatedAt: string | Date;
};

function SlaIndicator({ cell }: { cell: SlaCell }) {
  const t = useT("tickets");
  return (
    <span className="inline-flex flex-col items-start gap-0.5">
      <ToneBadge meta={metaFor(SLA_STATE_META, cell.state)} />
      {cell.detail ? <span className="text-xs text-muted-foreground">{localizeSlaDetail(cell.detail, t)}</span> : null}
    </span>
  );
}

function SortHead({
  k,
  label,
  className,
  sort,
  dir,
  onToggle,
}: {
  k: string;
  label: string;
  className?: string;
  sort: string;
  dir: "asc" | "desc";
  onToggle: (k: string) => void;
}) {
  const active = sort === k;
  const Icon = active ? (dir === "asc" ? ArrowUp : ArrowDown) : ChevronsUpDown;
  return (
    <TableHead className={className}>
      <button
        type="button"
        onClick={() => onToggle(k)}
        className={cn("inline-flex items-center gap-1 hover:text-foreground", active ? "text-foreground" : "")}
      >
        {label}
        <Icon className={cn("size-3.5", active ? "opacity-80" : "opacity-40")} />
      </button>
    </TableHead>
  );
}

export function TicketsTable({
  rows,
  sort,
  dir,
  canBulk,
  bulkOptions,
}: {
  rows: Row[];
  sort: string;
  dir: "asc" | "desc";
  canBulk: boolean;
  bulkOptions: BulkEditOptions;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [navPending, startNav] = useTransition();

  const [sel, setSel] = useState<Set<number>>(new Set());
  const [problemOpen, setProblemOpen] = useState(false);
  const tr = useT("tickets");
  const tc = useT("common");

  function toggleSort(k: string) {
    const params = new URLSearchParams(sp.toString());
    const nextDir = sort === k ? (dir === "asc" ? "desc" : "asc") : k === "updatedAt" || k === "id" ? "desc" : "asc";
    params.set("sort", k);
    params.set("dir", nextDir);
    params.delete("page");
    startNav(() => router.push(`${pathname}?${params.toString()}`));
  }

  const allSelected = rows.length > 0 && rows.every((r) => sel.has(r.id));
  const some = sel.size > 0;
  function toggleAll() {
    setSel(allSelected ? new Set() : new Set(rows.map((r) => r.id)));
  }
  function toggleOne(id: number) {
    setSel((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  function onBulkApplied() {
    setSel(new Set());
    router.refresh();
  }

  const sortHead = { sort, dir, onToggle: toggleSort };

  return (
    <div className="grid gap-2">
      {canBulk && some ? (
        <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 rounded-xl border bg-card/95 px-3 py-2 backdrop-blur">
          <span className="text-sm font-medium">{tr("table.selected", { count: sel.size })}</span>
          <BulkEditDialog ticketIds={[...sel]} options={bulkOptions} onApplied={onBulkApplied} />
          <Button type="button" variant="outline" size="sm" onClick={() => setProblemOpen(true)}>
            <TriangleAlert className="size-4" /> {tr("raiseProblem.title")}
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => setSel(new Set())}>
            <X className="size-4" /> {tc("clear")}
          </Button>
          <RaiseProblemDialog
            open={problemOpen}
            onOpenChange={setProblemOpen}
            ticketIds={[...sel]}
            draft={problemDraftFromTickets(rows.filter((r) => sel.has(r.id)))}
          />
        </div>
      ) : null}

      <div className={cn("overflow-hidden rounded-xl border bg-card", navPending && "opacity-70")}>
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              {canBulk ? (
                <TableHead className="w-[40px]">
                  <Checkbox
                    checked={allSelected}
                    indeterminate={some && !allSelected}
                    onCheckedChange={toggleAll}
                    aria-label={tr("table.selectAll")}
                  />
                </TableHead>
              ) : null}
              <SortHead {...sortHead} k="id" label={tr("table.ref")} className="w-[92px]" />
              <SortHead {...sortHead} k="title" label={tr("form.subject")} />
              <SortHead {...sortHead} k="requester" label={tc("requester")} className="hidden lg:table-cell" />
              <TableHead>{tc("priority")}</TableHead>
              <SortHead {...sortHead} k="status" label={tc("status")} />
              <SortHead {...sortHead} k="sla" label="SLA" className="hidden md:table-cell" />
              <SortHead {...sortHead} k="assignee" label={tc("assignee")} className="hidden md:table-cell" />
              <SortHead {...sortHead} k="createdAt" label={tc("created")} className="hidden 2xl:table-cell text-right" />
              <SortHead {...sortHead} k="updatedAt" label={tc("updated")} className="hidden xl:table-cell text-right" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((t) => (
              <TableRow key={t.id} className={cn("group", sel.has(t.id) && "bg-primary/5")}>
                {canBulk ? (
                  <TableCell className="w-[40px]">
                    <Checkbox checked={sel.has(t.id)} onCheckedChange={() => toggleOne(t.id)} aria-label={tr("table.selectRef", { ref: ticketRef(t.id, t.prefix) })} />
                  </TableCell>
                ) : null}
                <TableCell className="font-mono text-xs text-muted-foreground">{ticketRef(t.id, t.prefix)}</TableCell>
                <TableCell className="max-w-[420px]">
                  <Link href={`/tickets/${t.id}`} className="block">
                    <span className="line-clamp-1 font-medium group-hover:text-primary">{t.title}</span>
                    {t.category ? <span className="text-xs text-muted-foreground">{t.category}</span> : null}
                  </Link>
                </TableCell>
                <TableCell className="hidden lg:table-cell text-sm text-muted-foreground">
                  <span className="inline-flex items-center gap-1.5">
                    {t.requesterVip ? <VipBadge label={false} /> : null}
                    {t.requesterName}
                  </span>
                </TableCell>
                <TableCell>
                  <StatusBadge map={PRIORITY_META} value={t.priority} dot />
                </TableCell>
                <TableCell>
                  <StatusBadge map={TICKET_STATUS_META} value={t.status} />
                </TableCell>
                <TableCell className="hidden md:table-cell">{t.sla ? <SlaIndicator cell={t.sla} /> : null}</TableCell>
                <TableCell className="hidden md:table-cell">
                  {t.assignee ? (
                    <div className="flex items-center gap-2">
                      <UserAvatar name={t.assignee.name} email={t.assignee.email} size="sm" />
                      <span className="text-sm text-muted-foreground">{t.assignee.name?.split(" ")[0] ?? t.assignee.email}</span>
                    </div>
                  ) : (
                    <span className="text-xs text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell className="hidden 2xl:table-cell text-right text-xs text-muted-foreground">
                  <LocalTime date={t.createdAt} render={(d, f) => f.date(d)} />
                </TableCell>
                <TableCell className="hidden xl:table-cell text-right text-xs text-muted-foreground">
                  <LocalTime date={t.updatedAt} render={timeAgo} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
