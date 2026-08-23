"use client";

import { useState, useTransition } from "react";
import {
  Plus, Pencil, Trash2, Loader2, Save, MessageSquareText, Share2, User as UserIcon,
  X, ArrowUp, ArrowDown, GripVertical,
} from "lucide-react";
import { createMacro, updateMacro, deleteMacro, type MacroState } from "@/lib/actions/macros";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Combobox, type ComboOption } from "@/components/combobox";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { ConfirmButton } from "@/components/confirm-dialog";
import { PRIORITIES, PRIORITY_META, TICKET_STATUSES, TICKET_STATUS_META } from "@/lib/constants";

export type MacroRow = {
  id: string;
  name: string;
  description: string | null;
  actions: string; // JSON MacroAction[]
  isShared: boolean;
  ownerId: string | null;
  ownerName: string | null;
  canManage: boolean;
};

// Kept in sync with lib/actions/macros.ts (a "use server" file can't export this
// runtime tuple, so the client editor keeps its own copy).
const MACRO_ACTION_TYPES = [
  "set_status", "set_priority", "assign", "set_group", "add_reply", "add_comment",
] as const;
type MacroActionType = (typeof MACRO_ACTION_TYPES)[number];
type MacroAction = { type: MacroActionType; value: string };

type Opt = { value: string; label: string; hint?: string };

const ACTION_LABEL: Record<MacroActionType, string> = {
  set_status: "Set status",
  set_priority: "Set priority",
  assign: "Assign to",
  set_group: "Route to group",
  add_reply: "Post public reply",
  add_comment: "Add internal note",
};

const ACTION_OPTS: ComboOption[] = MACRO_ACTION_TYPES.map((t) => ({ value: t, label: ACTION_LABEL[t] }));

const STATUS_OPTS: ComboOption[] = TICKET_STATUSES.map((s) => ({
  value: s, label: TICKET_STATUS_META[s].label, tone: TICKET_STATUS_META[s].tone, icon: TICKET_STATUS_META[s].icon,
}));
const PRIORITY_OPTS: ComboOption[] = PRIORITIES.map((p) => ({
  value: p, label: PRIORITY_META[p].label, tone: PRIORITY_META[p].tone, icon: PRIORITY_META[p].icon,
}));

function safeParse(json: string): MacroAction[] {
  try {
    const raw = JSON.parse(json) as unknown;
    if (Array.isArray(raw)) return raw as MacroAction[];
  } catch {
    /* fallthrough */
  }
  return [];
}

function Field({ label, error, children, hint }: { label: string; error?: string[]; children: React.ReactNode; hint?: string }) {
  return (
    <div className="grid gap-1.5">
      <Label>{label}</Label>
      {children}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      {error ? <p className="text-xs text-destructive">{error[0]}</p> : null}
    </div>
  );
}

/** Editor for one action row: pick a type, then a type-specific value control. */
function ActionRow({
  action, index, count, agents, groups, onChange, onMove, onRemove,
}: {
  action: MacroAction;
  index: number;
  count: number;
  agents: Opt[];
  groups: Opt[];
  onChange: (next: MacroAction) => void;
  onMove: (dir: -1 | 1) => void;
  onRemove: () => void;
}) {
  const setType = (type: string) => onChange({ type: (type || "set_status") as MacroActionType, value: "" });
  const setValue = (value: string) => onChange({ ...action, value });

  const agentOpts: ComboOption[] = [
    { value: "", label: "Unassigned" },
    ...agents.map((a) => ({ value: a.value, label: a.label, hint: a.hint, avatar: (a.label || "?").slice(0, 2) })),
  ];
  const groupOpts: ComboOption[] = [{ value: "", label: "No group" }, ...groups];

  return (
    <div className="rounded-lg border bg-card p-3">
      <div className="flex items-center gap-2">
        <GripVertical className="size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <Combobox options={ACTION_OPTS} value={action.type} onChange={setType} placeholder="Choose an action" searchPlaceholder="Search actions…" />
        </div>
        <Button type="button" variant="ghost" size="icon-sm" disabled={index === 0} onClick={() => onMove(-1)} aria-label="Move up">
          <ArrowUp className="size-4" />
        </Button>
        <Button type="button" variant="ghost" size="icon-sm" disabled={index === count - 1} onClick={() => onMove(1)} aria-label="Move down">
          <ArrowDown className="size-4" />
        </Button>
        <Button type="button" variant="ghost" size="icon-sm" onClick={onRemove} aria-label="Remove action">
          <X className="size-4" />
        </Button>
      </div>

      <div className="mt-2 pl-6">
        {action.type === "set_status" ? (
          <Combobox options={STATUS_OPTS} value={action.value} onChange={setValue} placeholder="Choose a status" searchPlaceholder="Search statuses…" />
        ) : action.type === "set_priority" ? (
          <Combobox options={PRIORITY_OPTS} value={action.value} onChange={setValue} placeholder="Choose a priority" searchPlaceholder="Search priorities…" />
        ) : action.type === "assign" ? (
          <Combobox options={agentOpts} value={action.value} onChange={setValue} placeholder="Choose an agent" searchPlaceholder="Search agents…" />
        ) : action.type === "set_group" ? (
          <Combobox options={groupOpts} value={action.value} onChange={setValue} placeholder="Choose a group" searchPlaceholder="Search groups…" />
        ) : (
          <Textarea
            value={action.value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={action.type === "add_reply" ? "Reply the requester will see…" : "Private note for agents…"}
            className="min-h-20"
          />
        )}
      </div>
    </div>
  );
}

function MacroDialog({
  macro, canShare, agents, groups,
}: {
  macro?: MacroRow;
  canShare: boolean;
  agents: Opt[];
  groups: Opt[];
}) {
  const editing = !!macro;
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<MacroState>(undefined);
  const [pending, startTransition] = useTransition();
  const [isShared, setIsShared] = useState(macro?.isShared ?? false);
  const [actions, setActions] = useState<MacroAction[]>(
    macro ? safeParse(macro.actions) : [{ type: "add_reply", value: "" }],
  );
  const fe = state?.fieldErrors ?? {};

  const reset = () => {
    setActions(macro ? safeParse(macro.actions) : [{ type: "add_reply", value: "" }]);
    setIsShared(macro?.isShared ?? false);
    setState(undefined);
  };

  const addAction = () => setActions((a) => [...a, { type: "set_status", value: "" }]);
  const updateAction = (i: number, next: MacroAction) =>
    setActions((a) => a.map((x, idx) => (idx === i ? next : x)));
  const removeAction = (i: number) => setActions((a) => a.filter((_, idx) => idx !== i));
  const moveAction = (i: number, dir: -1 | 1) =>
    setActions((a) => {
      const j = i + dir;
      if (j < 0 || j >= a.length) return a;
      const copy = [...a];
      [copy[i], copy[j]] = [copy[j], copy[i]];
      return copy;
    });

  const submit = (formData: FormData) => {
    formData.set("actions", JSON.stringify(actions));
    formData.set("isShared", String(isShared));
    startTransition(async () => {
      const res = await (editing ? updateMacro : createMacro)(undefined, formData);
      setState(res);
      if (!res || res.ok) {
        setOpen(false);
        if (!editing) reset();
      }
    });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (v) reset();
      }}
    >
      <DialogTrigger render={<Button variant={editing ? "outline" : "default"} size={editing ? "icon-sm" : "default"} aria-label={editing ? "Edit macro" : undefined} />}>
        {editing ? <Pencil className="size-4" /> : <><Plus className="size-4" /> New macro</>}
      </DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MessageSquareText className="size-4 text-primary" /> {editing ? "Edit macro" : "New macro"}
          </DialogTitle>
          <DialogDescription>Actions run top-to-bottom when an agent applies the macro to a ticket.</DialogDescription>
        </DialogHeader>

        <form action={submit} className="grid max-h-[70vh] gap-4 overflow-y-auto px-0.5">
          {editing ? <input type="hidden" name="id" value={macro.id} /> : null}

          {state?.error ? (
            <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{state.error}</p>
          ) : null}

          <Field label="Name" error={fe.name}>
            <Input name="name" defaultValue={macro?.name} placeholder="e.g. Ask for more info" required />
          </Field>

          <Field label="Description" error={fe.description}>
            <Input name="description" defaultValue={macro?.description ?? ""} placeholder="When should an agent reach for this?" />
          </Field>

          <div className="grid gap-2">
            <div className="flex items-center justify-between">
              <Label>Actions</Label>
              <Button type="button" variant="outline" size="sm" onClick={addAction}>
                <Plus className="size-4" /> Add action
              </Button>
            </div>
            {fe.actions ? <p className="text-xs text-destructive">{fe.actions[0]}</p> : null}
            {actions.length === 0 ? (
              <p className="rounded-lg border border-dashed p-4 text-center text-xs text-muted-foreground">
                No actions yet. Add one to get started.
              </p>
            ) : (
              <div className="grid gap-2">
                {actions.map((a, i) => (
                  <ActionRow
                    key={i}
                    action={a}
                    index={i}
                    count={actions.length}
                    agents={agents}
                    groups={groups}
                    onChange={(next) => updateAction(i, next)}
                    onMove={(dir) => moveAction(i, dir)}
                    onRemove={() => removeAction(i)}
                  />
                ))}
              </div>
            )}
          </div>

          {canShare ? (
            <label className="flex items-center justify-between rounded-lg border p-3 text-sm">
              <span className="flex items-center gap-2">
                <Share2 className="size-4 text-muted-foreground" />
                <span>
                  Shared macro
                  <span className="block text-xs text-muted-foreground">Available to every agent. Off = only you.</span>
                </span>
              </span>
              <Switch checked={isShared} onCheckedChange={setIsShared} />
            </label>
          ) : null}

          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
              {editing ? "Save macro" : "Create macro"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function MacroManager({
  macros, canShare, agents, groups,
}: {
  macros: MacroRow[];
  canShare: boolean;
  agents: Opt[];
  groups: Opt[];
}) {
  return (
    <div className="grid gap-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {macros.length} macro{macros.length === 1 ? "" : "s"} · applied from the ticket detail toolbar.
        </p>
        <MacroDialog canShare={canShare} agents={agents} groups={groups} />
      </div>

      {macros.length === 0 ? (
        <div className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">
          No macros yet. Create one to bundle common ticket actions into a single click.
        </div>
      ) : (
        <div className="divide-y overflow-hidden rounded-xl border">
          {macros.map((m) => {
            const acts = safeParse(m.actions);
            return (
              <div key={m.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <span className="grid size-9 place-items-center rounded-lg border text-primary">
                  <MessageSquareText className="size-4.5" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-medium">{m.name}</span>
                    {m.isShared ? (
                      <span className="inline-flex items-center gap-1 rounded-full border px-1.5 text-[10px] font-medium text-muted-foreground">
                        <Share2 className="size-3" /> Shared
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-full border px-1.5 text-[10px] font-medium text-muted-foreground">
                        <UserIcon className="size-3" /> Personal{m.ownerName ? ` · ${m.ownerName}` : ""}
                      </span>
                    )}
                  </div>
                  <div className="truncate text-xs text-muted-foreground">
                    {m.description || `${acts.length} action${acts.length === 1 ? "" : "s"}: ${acts.map((a) => ACTION_LABEL[a.type] ?? a.type).join(", ")}`}
                  </div>
                </div>

                {m.canManage ? (
                  <div className="flex items-center gap-1">
                    <MacroDialog macro={m} canShare={canShare} agents={agents} groups={groups} />
                    <ConfirmButton
                      action={deleteMacro}
                      fields={{ id: m.id }}
                      title="Delete macro?"
                      description={`"${m.name}" will be removed. This can't be undone.`}
                      triggerLabel="Delete macro"
                    >
                      <Trash2 className="size-4" />
                    </ConfirmButton>
                  </div>
                ) : (
                  <span className="text-xs text-muted-foreground">Read-only</span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
