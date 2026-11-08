"use client";

import { useState, useTransition } from "react";
import { Plus, Trash2, Save, RotateCcw, ArrowRight, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { saveWorkflow, resetWorkflow } from "@/lib/actions/workflows";
import { Button } from "@/components/ui/button";
import { Combobox, type ComboOption } from "@/components/combobox";
import { ToneBadge } from "@/components/status-badge";
import type { Tone } from "@/lib/constants";
import { useT } from "@/lib/i18n/client";

type StatusDef = { value: string; label: string; tone: Tone };
type Transition = { from: string; to: string; requiredRole: string | null };
type Row = { from: string; to: string; role: string }; // role: none|MANAGER|ADMIN

function Badge({ status, meta }: { status: string; meta: Map<string, StatusDef> }) {
  const m = meta.get(status);
  return <ToneBadge meta={{ label: m?.label ?? status, tone: m?.tone ?? ("neutral" as Tone) }} icon={false} />;
}

export function WorkflowList({
  entityType,
  statuses,
  transitions,
}: {
  entityType: string;
  statuses: StatusDef[];
  transitions: Transition[];
}) {
  const [rows, setRows] = useState<Row[]>(
    transitions.map((t) => ({ from: t.from, to: t.to, role: t.requiredRole ?? "none" })),
  );
  const [addFrom, setAddFrom] = useState("none");
  const [addTo, setAddTo] = useState("none");
  const [pending, start] = useTransition();
  const tr = useT("settings");
  const roleOpts: ComboOption[] = [
    { value: "none", label: tr("wf.anyone") },
    { value: "MANAGER", label: tr("wf.managerPlus") },
    { value: "ADMIN", label: tr("wf.adminOnly") },
  ];

  const meta = new Map(statuses.map((s) => [s.value, s]));
  const order = new Map(statuses.map((s, i) => [s.value, i]));
  const statusOpts: ComboOption[] = statuses.map((s) => ({ value: s.value, label: s.label, tone: s.tone }));

  const has = (f: string, t: string) => rows.some((r) => r.from === f && r.to === t);

  function add() {
    if (addFrom === "none" || addTo === "none" || addFrom === addTo) return;
    if (has(addFrom, addTo)) {
      toast.error(tr("wf.alreadyAllowed"));
      return;
    }
    setRows((r) => [...r, { from: addFrom, to: addTo, role: "none" }]);
    setAddFrom("none");
    setAddTo("none");
  }
  const remove = (f: string, t: string) => setRows((r) => r.filter((x) => !(x.from === f && x.to === t)));
  const setRole = (f: string, t: string, role: string) =>
    setRows((r) => r.map((x) => (x.from === f && x.to === t ? { ...x, role } : x)));

  function persist(action: (fd: FormData) => Promise<void>, withRows: boolean, msg: string) {
    const fd = new FormData();
    fd.set("entityType", entityType);
    if (withRows) {
      fd.set(
        "transitions",
        JSON.stringify(rows.map((r) => ({ fromStatus: r.from, toStatus: r.to, requiredRole: r.role === "none" ? null : r.role }))),
      );
    }
    start(async () => {
      await action(fd);
      toast.success(msg);
    });
  }

  const sorted = [...rows].sort(
    (a, b) => (order.get(a.from)! - order.get(b.from)!) || (order.get(a.to)! - order.get(b.to)!),
  );

  return (
    <div className="grid gap-4">
      {/* Add a transition — pick any two statuses (freehand). */}
      <div className="flex flex-wrap items-end gap-2 rounded-lg border bg-card/40 p-3">
        <div className="grid gap-1">
          <span className="text-[11px] text-muted-foreground">{tr("wf.from")}</span>
          <div className="w-40">
            <Combobox options={statusOpts} value={addFrom} onChange={setAddFrom} placeholder={tr("wf.statusPlaceholder")} size="sm" />
          </div>
        </div>
        <ArrowRight className="mb-1.5 size-4 text-muted-foreground" />
        <div className="grid gap-1">
          <span className="text-[11px] text-muted-foreground">{tr("wf.to")}</span>
          <div className="w-40">
            <Combobox options={statusOpts} value={addTo} onChange={setAddTo} placeholder={tr("wf.statusPlaceholder")} size="sm" />
          </div>
        </div>
        <Button type="button" size="sm" variant="outline" onClick={add} disabled={addFrom === "none" || addTo === "none" || addFrom === addTo}>
          <Plus className="size-4" /> {tr("wf.addTransition")}
        </Button>
      </div>

      {/* Allowed transitions */}
      {sorted.length === 0 ? (
        <p className="text-sm text-muted-foreground">{tr("wf.empty")}</p>
      ) : (
        <div className="grid gap-1.5">
          {sorted.map((r) => (
            <div key={`${r.from}>${r.to}`} className="flex flex-wrap items-center gap-3 rounded-md border px-3 py-2">
              <Badge status={r.from} meta={meta} />
              <ArrowRight className="size-3.5 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <Badge status={r.to} meta={meta} />
              </div>
              <div className="w-40 shrink-0">
                <Combobox options={roleOpts} value={r.role} onChange={(v) => setRole(r.from, r.to, v)} size="sm" />
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={tr("wf.removeTransition")}
                onClick={() => remove(r.from, r.to)}
                className="text-muted-foreground hover:text-destructive"
              >
                <Trash2 className="size-4" />
              </Button>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between gap-2 border-t pt-3">
        <Button type="button" variant="ghost" size="sm" className="text-muted-foreground" disabled={pending} onClick={() => persist(resetWorkflow, false, tr("wf.resetDone"))}>
          <RotateCcw className="size-4" /> {tr("wf.resetToDefaults")}
        </Button>
        <Button type="button" size="sm" disabled={pending} onClick={() => persist(saveWorkflow, true, tr("wf.saved"))}>
          {pending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
          {tr("wf.saveChanges")}
        </Button>
      </div>
    </div>
  );
}
