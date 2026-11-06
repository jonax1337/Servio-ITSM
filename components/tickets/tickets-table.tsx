"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { ArrowUp, ArrowDown, ChevronsUpDown, Loader2, TriangleAlert, X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Combobox, type ComboOption } from "@/components/combobox";
import { StatusBadge, VipBadge } from "@/components/status-badge";
import { UserAvatar } from "@/components/user-avatar";
import { RaiseProblemDialog } from "@/components/tickets/raise-problem-dialog";
import { bulkUpdateTickets } from "@/lib/actions/tickets";
import { problemDraftFromTickets } from "@/lib/ticket-drafts";
import {
  PRIORITY_META, TICKET_STATUS_META, PRIORITIES, ticketRef,
} from "@/lib/constants";
import { format, formatDistanceToNow } from "date-fns";

type Row = {
  id: number;
  prefix: string;
  title: string;
  category: string | null;
  requesterName: string;
  requesterVip: boolean;
  priority: string;
  status: string;
  assignee: { name: string | null; email: string } | null;
  createdAt: string | Date;
  updatedAt: string | Date;
};

const FIELD_OPTS: ComboOption[] = [
  { value: "assigneeId", label: "Assignee" },
  { value: "groupId", label: "Group" },
  { value: "priority", label: "Priority" },
  { value: "status", label: "Status" },
];
// Bulk status is limited to transitions that don't need a reason/note.
const BULK_STATUSES = ["OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED"];

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
  agents,
  groups,
}: {
  rows: Row[];
  sort: string;
  dir: "asc" | "desc";
  canBulk: boolean;
  agents: { value: string; label: string }[];
  groups: { value: string; label: string }[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [navPending, startNav] = useTransition();

  const [sel, setSel] = useState<Set<number>>(new Set());
  const [field, setField] = useState("assigneeId");
  const [value, setValue] = useState("none");
  const [applyPending, startApply] = useTransition();
  const [problemOpen, setProblemOpen] = useState(false);

  function toggleSort(k: string) {
    const params = new URLSearchParams(sp.toString());
    const curSort = params.get("sort") ?? "updatedAt";
    const curDir = params.get("dir") === "asc" ? "asc" : "desc";
    const nextDir = curSort === k ? (curDir === "asc" ? "desc" : "asc") : k === "updatedAt" || k === "id" ? "desc" : "asc";
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

  function valueOptsFor(f: string): ComboOption[] {
    if (f === "priority") return PRIORITIES.map((p) => ({ value: p, label: PRIORITY_META[p].label, tone: PRIORITY_META[p].tone }));
    if (f === "status") return BULK_STATUSES.map((s) => ({ value: s, label: TICKET_STATUS_META[s].label, tone: TICKET_STATUS_META[s].tone }));
    if (f === "groupId") return [{ value: "none", label: "No group" }, ...groups];
    return [{ value: "none", label: "Unassigned" }, ...agents];
  }
  function changeField(f: string) {
    setField(f);
    const first = valueOptsFor(f)[0]?.value ?? "";
    setValue(first);
  }

  function apply() {
    if (!some) return;
    const fd = new FormData();
    fd.set("ids", [...sel].join(","));
    fd.set("field", field);
    fd.set("value", value);
    startApply(async () => {
      await bulkUpdateTickets(fd);
      setSel(new Set());
      router.refresh();
    });
  }

  const sortHead = { sort, dir, onToggle: toggleSort };

  return (
    <div className="grid gap-2">
      {canBulk && some ? (
        <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 rounded-xl border bg-card/95 px-3 py-2 backdrop-blur">
          <span className="text-sm font-medium">{sel.size} selected</span>
          <span className="mx-1 text-muted-foreground">·</span>
          <span className="text-sm text-muted-foreground">Set</span>
          <Combobox options={FIELD_OPTS} value={field} onChange={changeField} size="sm" className="w-auto min-w-[8rem]" />
          <Combobox options={valueOptsFor(field)} value={value} onChange={(v) => setValue(v || "none")} size="sm" className="w-auto min-w-[10rem]" searchPlaceholder="Search…" />
          <Button type="button" size="sm" onClick={apply} disabled={applyPending}>
            {applyPending ? <Loader2 className="size-4 animate-spin" /> : null} Apply
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => setProblemOpen(true)}>
            <TriangleAlert className="size-4" /> Create problem
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => setSel(new Set())}>
            <X className="size-4" /> Clear
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
                    aria-label="Select all"
                  />
                </TableHead>
              ) : null}
              <SortHead {...sortHead} k="id" label="Ref" className="w-[92px]" />
              <SortHead {...sortHead} k="title" label="Subject" />
              <SortHead {...sortHead} k="requester" label="Requester" className="hidden lg:table-cell" />
              <TableHead>Priority</TableHead>
              <SortHead {...sortHead} k="status" label="Status" />
              <SortHead {...sortHead} k="assignee" label="Assignee" className="hidden md:table-cell" />
              <SortHead {...sortHead} k="createdAt" label="Created" className="hidden 2xl:table-cell text-right" />
              <SortHead {...sortHead} k="updatedAt" label="Updated" className="hidden xl:table-cell text-right" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((t) => (
              <TableRow key={t.id} className={cn("group", sel.has(t.id) && "bg-primary/5")}>
                {canBulk ? (
                  <TableCell className="w-[40px]">
                    <Checkbox checked={sel.has(t.id)} onCheckedChange={() => toggleOne(t.id)} aria-label={`Select ${ticketRef(t.id, t.prefix)}`} />
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
                  {format(new Date(t.createdAt), "PP")}
                </TableCell>
                <TableCell className="hidden xl:table-cell text-right text-xs text-muted-foreground">
                  {formatDistanceToNow(new Date(t.updatedAt), { addSuffix: true })}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
