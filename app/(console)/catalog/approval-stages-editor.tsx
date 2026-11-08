"use client";

import { useActionState, useState } from "react";
import { Plus, Loader2, Save, Trash2, ChevronDown, ChevronUp, ListChecks, User, Users } from "lucide-react";
import { updateApprovalStages, type CatalogAdminState } from "@/lib/actions/catalog-admin";
import type { ApprovalStage } from "@/lib/service-forms";
import { Button } from "@/components/ui/button";
import { Combobox, type ComboOption } from "@/components/combobox";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { useServerMessage, useT } from "@/lib/i18n/client";

type Opt = { value: string; label: string }[];

/** A stage in the editor: exactly one of approver|group is chosen via a mode toggle. */
type EditorStage = { mode: "user" | "group"; approverId: string; groupId: string };

function toEditorStages(stages: ApprovalStage[]): EditorStage[] {
  return stages.map((s) =>
    s.groupId
      ? { mode: "group", approverId: "", groupId: s.groupId }
      : { mode: "user", approverId: s.approverId ?? "", groupId: "" },
  );
}

export function ApprovalStagesEditor({
  itemId, itemName, stages, agents, groups,
}: {
  itemId: string;
  itemName: string;
  stages: ApprovalStage[];
  agents: Opt;
  groups: Opt;
}) {
  const [open, setOpen] = useState(false);
  const t = useT("catalog");
  const tc = useT("common");
  const tm = useServerMessage();
  const [state, action, pending] = useActionState<CatalogAdminState, FormData>(updateApprovalStages, undefined);
  const [rows, setRows] = useState<EditorStage[]>(
    stages.length > 0 ? toEditorStages(stages) : [{ mode: "user", approverId: "", groupId: "" }],
  );

  const agentOpts: ComboOption[] = agents.map((a) => ({ ...a, avatar: a.label.slice(0, 2).toUpperCase() }));
  const groupOpts: ComboOption[] = groups.map((g) => ({ ...g, icon: Users }));

  const setRow = (i: number, patch: Partial<EditorStage>) =>
    setRows((r) => r.map((x, idx) => (idx === i ? { ...x, ...patch } : x)));
  const move = (i: number, dir: -1 | 1) =>
    setRows((r) => {
      const j = i + dir;
      if (j < 0 || j >= r.length) return r;
      const next = [...r];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });

  // Serialise to the ApprovalStage[] shape the action parses.
  const payload: ApprovalStage[] = rows
    .map((r) => (r.mode === "group" ? { groupId: r.groupId } : { approverId: r.approverId }))
    .filter((s) => ("groupId" in s ? s.groupId : s.approverId));

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline" size="icon-sm" aria-label={t("approvalStages")} />}>
        <ListChecks className="size-4" />
      </DialogTrigger>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ListChecks className="size-4 text-primary" /> {t("approvalStages")}
          </DialogTitle>
          <DialogDescription>
            {t.rich("stagesDescription", { name: itemName, b: (c) => <span className="font-medium text-foreground">{c}</span> })}
          </DialogDescription>
        </DialogHeader>

        <form action={async (fd) => { await action(fd); setOpen(false); }} className="grid gap-4">
          <input type="hidden" name="id" value={itemId} />
          <input type="hidden" name="approvalStages" value={JSON.stringify(payload)} />

          {state?.error ? (
            <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{tm(state.error)}</p>
          ) : null}

          <div className="grid gap-2">
            {rows.length === 0 ? (
              <p className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
                {t("noStages")}
              </p>
            ) : (
              rows.map((r, i) => (
                <div key={i} className="grid gap-2 rounded-lg border bg-card p-3">
                  <div className="flex items-center gap-2">
                    <span className="grid size-6 shrink-0 place-items-center rounded-md bg-primary/10 text-xs font-semibold text-primary tabular-nums">{i + 1}</span>
                    <div className="ml-auto flex items-center gap-0.5">
                      <Button type="button" variant="ghost" size="icon-sm" aria-label={t("moveUp")} disabled={i === 0} onClick={() => move(i, -1)}>
                        <ChevronUp className="size-4 text-muted-foreground" />
                      </Button>
                      <Button type="button" variant="ghost" size="icon-sm" aria-label={t("moveDown")} disabled={i === rows.length - 1} onClick={() => move(i, 1)}>
                        <ChevronDown className="size-4 text-muted-foreground" />
                      </Button>
                      <Button type="button" variant="ghost" size="icon-sm" aria-label={t("removeStage")} onClick={() => setRows((arr) => arr.filter((_, idx) => idx !== i))}>
                        <Trash2 className="size-4 text-muted-foreground" />
                      </Button>
                    </div>
                  </div>
                  <div className="flex gap-1 rounded-md border bg-muted/40 p-0.5 text-sm">
                    <button
                      type="button"
                      onClick={() => setRow(i, { mode: "user" })}
                      className={`flex flex-1 items-center justify-center gap-1.5 rounded px-2 py-1 ${r.mode === "user" ? "bg-card font-medium shadow-sm" : "text-muted-foreground"}`}
                    >
                      <User className="size-3.5" /> {t("person")}
                    </button>
                    <button
                      type="button"
                      onClick={() => setRow(i, { mode: "group" })}
                      className={`flex flex-1 items-center justify-center gap-1.5 rounded px-2 py-1 ${r.mode === "group" ? "bg-card font-medium shadow-sm" : "text-muted-foreground"}`}
                    >
                      <Users className="size-3.5" /> {tc("group")}
                    </button>
                  </div>
                  {r.mode === "user" ? (
                    <Combobox options={agentOpts} value={r.approverId} onChange={(v) => setRow(i, { approverId: v })} placeholder={t("chooseApprover")} searchPlaceholder={t("searchPeople")} />
                  ) : (
                    <Combobox options={groupOpts} value={r.groupId} onChange={(v) => setRow(i, { groupId: v })} placeholder={t("chooseGroup")} searchPlaceholder={t("searchGroups")} />
                  )}
                </div>
              ))
            )}
            <Button type="button" variant="outline" size="sm" className="justify-self-start" onClick={() => setRows((r) => [...r, { mode: "user", approverId: "", groupId: "" }])}>
              <Plus className="size-4" /> {t("addStage")}
            </Button>
          </div>

          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
              {t("saveStages")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
