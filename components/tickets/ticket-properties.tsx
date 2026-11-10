"use client";

import { useEffect, useRef, useState } from "react";
import { serviceLabel } from "@/lib/service-label";
import { useRouter } from "next/navigation";
import { SableMark } from "@/components/sable-mark";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { updateTicketField, setTicketResolution, setTicketPending } from "@/lib/actions/tickets";
import { type TriageState } from "@/lib/actions/ai";
import { Button } from "@/components/ui/button";
import { Combobox, type ComboOption } from "@/components/combobox";
import { PendingReasonDialog, type PendingPayload } from "@/components/tickets/pending-reason-dialog";
import { ResolutionDialog, type ResolutionPayload } from "@/components/tickets/resolution-dialog";
import { DueDatePicker } from "@/components/tickets/due-date-picker";
import type { RefusedChild } from "@/lib/ticket-hierarchy-rules";
import { useEnumT, useServerMessage, useT } from "@/lib/i18n/client";
import type { Translator } from "@/lib/i18n/translate";
import {
  PROPERTY_KEYS, UNDO_WINDOW_MS, applyPropertyEdit, changesBetween, undoBlocker, undoChanges, withChanges,
  type FieldChange, type PropertyKey, type PropertyValues, type UndoBlocker,
} from "@/lib/ticket-property-edits";
import {
  TICKET_STATUSES,
  TICKET_TYPES,
  PRIORITIES,
  IMPACT_URGENCY,
  TICKET_STATUS_META,
  TICKET_TYPE_META,
  PRIORITY_META,
  LEVEL_META,
} from "@/lib/constants";
import type { FormOptions } from "@/lib/data/options";

/** The refusal message of a ticket action result, or null when it went through. */
const errorOf = (res: { ok: boolean; error?: string }) => (res.ok ? null : res.error ?? SAVE_FAILED);

/** English source of the generic save failure; translated where it is shown (server catalog). */
const SAVE_FAILED = "Could not save changes.";

const UNDO_BLOCKED: Record<UndoBlocker, "props.undoBlockedChanged" | "props.undoBlockedWorkflow"> = {
  changed: "props.undoBlockedChanged",
  workflow: "props.undoBlockedWorkflow",
};

/** An edit whose Undo is on offer in a toast. */
type UndoOffer = { before: PropertyValues; after: PropertyValues };

function initials(s: string) {
  return s.split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase();
}

type Suggestion = { value: string; label: string };

/** A single property: a combobox that saves on change, with an optional inline Sable suggestion. */
function EditProp({
  label, value, options, searchable, placeholder, pending, suggestion, onChange, onApply, onDismiss,
}: {
  label: string;
  value: string;
  options: ComboOption[];
  searchable?: boolean;
  placeholder?: string;
  pending: boolean;
  suggestion: Suggestion | null;
  onChange: (v: string) => void;
  onApply: () => void;
  onDismiss: () => void;
}) {
  const t = useT("tickets");
  return (
    <div className="grid gap-1.5">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <Combobox
        options={options}
        value={value}
        pending={pending}
        placeholder={placeholder}
        searchPlaceholder={searchable ? t("props.searchField", { field: label }) : t("props.filter")}
        onChange={onChange}
        className={cn(suggestion && "border-sable/40 ring-2 ring-sable/30")}
      />
      {suggestion ? (
        <div className="sable-accent-border flex items-center gap-1 rounded-md border bg-sable-muted/50 px-2 py-1">
          <SableMark className="size-3.5 shrink-0 text-sable" />
          <span className="min-w-0 flex-1 truncate text-xs text-foreground/80">{suggestion.label}</span>
          <Button type="button" size="xs" className="shrink-0 bg-sable px-1.5 text-sable-foreground hover:bg-sable/90" onClick={onApply}>{t("props.apply")}</Button>
          <Button type="button" size="xs" variant="ghost" className="shrink-0 px-1.5 text-muted-foreground" onClick={onDismiss}>
            {t("props.dismiss")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

/** Field label keys in the "common" namespace. */
const FIELD_LABELS: Record<PropertyKey, "status" | "type" | "priority" | "impact" | "urgency" | "assignee" | "group" | "category" | "service"> = {
  status: "status", type: "type", priority: "priority", impact: "impact", urgency: "urgency",
  assigneeId: "assignee", groupId: "group", categoryId: "category", serviceId: "service",
};

/** "resolved 2 child tickets, 1 child ticket could not be resolved" — null when no children were involved. */
function childNoteOf(t: Translator<"tickets">, resolved: number, refused: number): string | null {
  const parts: string[] = [];
  if (resolved > 0) parts.push(t("props.childrenResolved", { count: resolved }));
  if (refused > 0) parts.push(t("props.childrenRefused", { count: refused }));
  return parts.length ? parts.join(", ") : null;
}

type TicketValues = {
  status: string; type: string; priority: string; impact: string; urgency: string;
  assigneeId: string | null; groupId: string | null; categoryId: string | null; serviceId: string | null;
};

const readValues = (t: TicketValues): PropertyValues => ({
  status: t.status,
  type: t.type,
  priority: t.priority,
  impact: t.impact,
  urgency: t.urgency,
  assigneeId: t.assigneeId ?? "none",
  groupId: t.groupId ?? "none",
  categoryId: t.categoryId ?? "none",
  serviceId: t.serviceId ?? "none",
});

/** What saving a status change through its dialog came to. */
type StatusOutcome = { refusal: string | null; childNote?: string | null; refusedChildren?: RefusedChild[] };

export function TicketProperties({
  ticket,
  options,
  aiEnabled = false,
  aiTeaser = false,
  triageEnabled = false,
  allowedStatuses,
  openChildCount = 0,
}: {
  ticket: TicketValues & { id: number; dueDate: Date | null };
  options: FormOptions;
  aiEnabled?: boolean;
  aiTeaser?: boolean;
  triageEnabled?: boolean;
  /** Statuses reachable from the current one under the workflow; others grey out. */
  allowedStatuses?: string[];
  /** Child tickets still open — resolving this ticket can take them along. */
  openChildCount?: number;
}) {
  const router = useRouter();
  const t = useT("tickets");
  const tc = useT("common");
  const te = useEnumT();
  const tm = useServerMessage();
  const fieldLabel = (k: PropertyKey) => tc(FIELD_LABELS[k]);
  // ── Options ──
  const allowedSet = allowedStatuses ? new Set(allowedStatuses) : null;
  const statusOpts: ComboOption[] = TICKET_STATUSES.map((s) => ({
    value: s, label: te(TICKET_STATUS_META, s), tone: TICKET_STATUS_META[s].tone, icon: TICKET_STATUS_META[s].icon,
    disabled: allowedSet ? !allowedSet.has(s) : false,
    disabledReason: t("props.notAllowedByWorkflow"),
  }));
  const prioOpts: ComboOption[] = PRIORITIES.map((p) => ({
    value: p, label: te(PRIORITY_META, p), tone: PRIORITY_META[p].tone, icon: PRIORITY_META[p].icon,
  }));
  const levelOpts: ComboOption[] = IMPACT_URGENCY.map((l) => ({ value: l, label: te(LEVEL_META, l), tone: LEVEL_META[l].tone }));
  const typeOpts: ComboOption[] = TICKET_TYPES.map((v) => ({
    value: v, label: te(TICKET_TYPE_META, v), tone: TICKET_TYPE_META[v].tone, icon: TICKET_TYPE_META[v].icon,
  }));
  const none = (label: string): ComboOption => ({ value: "none", label });
  const groupOpts: ComboOption[] = [none(t("form.noGroup")), ...options.groups.map((g) => ({ value: g.id, label: g.name }))];
  const catOpts: ComboOption[] = [none(t("form.noCategory")), ...options.categories.map((c) => ({ value: c.id, label: c.name }))];
  const svcOpts: ComboOption[] = [none(t("form.noService")), ...options.services.map((s) => ({ value: s.id, label: serviceLabel(s) }))];
  const groupName = (id: string) => options.groups.find((g) => g.id === id)?.name ?? id;
  const catName = (id: string) => options.categories.find((c) => c.id === id)?.name ?? id;
  const svcName = (id: string) => { const s = options.services.find((o) => o.id === id); return s ? serviceLabel(s) : id; };

  // ── Values shown: the saved ticket, plus edits that are still being saved ──
  const saved = readValues(ticket);
  const savedKey = PROPERTY_KEYS.map((k) => saved[k]).join("\u0000");
  const [values, setValues] = useState(saved);
  const [syncedWith, setSyncedWith] = useState(savedKey);
  const [saving, setSaving] = useState<PropertyKey[]>([]);

  // Take over the saved ticket when it changes elsewhere, but never in the middle of a save.
  if (syncedWith !== savedKey && saving.length === 0) {
    setSyncedWith(savedKey);
    setValues(saved);
  }

  const track = (keys: readonly PropertyKey[]) => setSaving((s) => [...s, ...keys]);
  const untrack = (keys: readonly PropertyKey[]) =>
    setSaving((s) => {
      const rest = [...s];
      for (const key of keys) rest.splice(rest.indexOf(key), 1);
      return rest;
    });

  // Assignee must be a member of the chosen group (any agent when there's no
  // group). The currently-selected assignee is always kept so it still shows.
  const memberIds = values.groupId !== "none" ? new Set(options.groupMembers[values.groupId] ?? []) : null;
  const assigneeOpts: ComboOption[] = [
    none(tc("unassigned")),
    ...options.agents
      .filter((a) => !memberIds || memberIds.has(a.id) || a.id === values.assigneeId)
      .map((a) => ({ value: a.id, label: a.name ?? a.email, avatar: initials(a.name ?? a.email), hint: a.email })),
  ];

  // ── Saving: each edit is saved on its own, then offered as an undo ──
  /** Saves field changes in order and returns the first refusal. */
  async function persistChanges(changes: readonly FieldChange[]): Promise<string | null> {
    for (const { field, value, expected } of changes) {
      const fd = new FormData();
      fd.set("id", String(ticket.id));
      fd.set("field", field);
      fd.set("value", value);
      if (expected !== undefined) fd.set("expected", expected);
      const refusal = errorOf(await updateTicketField(fd));
      if (refusal) return refusal;
    }
    return null;
  }

  async function saveChanges(changes: readonly FieldChange[]): Promise<string | null> {
    const keys = changes.map((c) => c.field);
    track(keys);
    try {
      return await persistChanges(changes);
    } catch {
      return SAVE_FAILED;
    } finally {
      untrack(keys);
    }
  }

  // Undo is offered only while it can still apply: the latest values are read at click time and
  // every open offer is withdrawn as soon as one of them goes stale.
  const latest = useRef({ values, allowedStatuses });
  const offers = useRef(new Map<string | number, UndoOffer>());
  const offerCount = useRef(0);
  useEffect(() => {
    latest.current = { values, allowedStatuses };
    for (const [toastId, { before, after }] of offers.current) {
      if (!undoBlocker(values, before, after, allowedStatuses)) continue;
      toast.dismiss(toastId);
      offers.current.delete(toastId);
    }
  });

  async function undoEdit(toastId: string | number, { before, after }: UndoOffer) {
    offers.current.delete(toastId);
    const blocker = undoBlocker(latest.current.values, before, after, latest.current.allowedStatuses);
    if (blocker) {
      toast.info(t(UNDO_BLOCKED[blocker]));
      return;
    }
    const reverts = undoChanges(before, after);
    setValues((v) => withChanges(v, reverts));
    const refusal = await saveChanges(reverts);
    if (refusal) {
      setValues((v) => withChanges(v, changesBetween(before, after)));
      toast.error(t("props.undoFailed", { reason: tm(refusal) }));
      router.refresh();
      return;
    }
    toast.success(t("props.changeUndone"));
  }

  async function saveEdit(edit: FieldChange, before: PropertyValues, after: PropertyValues) {
    const refusal = await saveChanges([edit]);
    if (refusal) {
      setValues((v) => withChanges(v, changesBetween(after, before)));
      toast.error(tm(refusal));
      return;
    }
    const toastId = `undo-${ticket.id}-${++offerCount.current}`;
    offers.current.set(toastId, { before, after });
    toast.success(t("props.fieldUpdated", { field: fieldLabel(edit.field) }), {
      id: toastId,
      duration: UNDO_WINDOW_MS,
      action: { label: t("props.undo"), onClick: () => void undoEdit(toastId, { before, after }) },
      onDismiss: () => offers.current.delete(toastId),
      onAutoClose: () => offers.current.delete(toastId),
    });
  }

  function editField(field: PropertyKey, value: string) {
    if (values[field] === value) return;
    const after = applyPropertyEdit(values, { field, value }, options.groupMembers);
    setValues(after);
    void saveEdit({ field, value }, values, after);
  }

  // ── Status pick → save directly, or open a dialog that captures the note and commits ──
  const [pendingDlg, setPendingDlg] = useState<{ open: boolean; status: string }>({ open: false, status: "PENDING" });
  const [resDlg, setResDlg] = useState<{ open: boolean; status: string }>({ open: false, status: "RESOLVED" });

  const changeStatus = (v: string) => {
    if (v === values.status) return;
    if (v === "PENDING" || v === "ON_HOLD") return setPendingDlg({ open: true, status: v });
    if (v === "RESOLVED" || v === "CLOSED" || v === "CANCELLED") return setResDlg({ open: true, status: v });
    editField("status", v);
  };

  /** Commits a status change made through a dialog; false keeps the dialog open so the agent can adjust. */
  async function commitStatus(status: string, save: () => Promise<StatusOutcome>): Promise<boolean> {
    const previous = values.status;
    setValues((v) => withChanges(v, [{ field: "status", value: status }]));
    track(["status"]);
    let outcome: StatusOutcome;
    try {
      outcome = await save();
    } catch {
      outcome = { refusal: SAVE_FAILED };
    } finally {
      untrack(["status"]);
    }
    if (outcome.refusal) {
      setValues((v) => withChanges(v, [{ field: "status", value: previous }]));
      toast.error(tm(outcome.refusal));
      return false;
    }
    const message = `${t("props.statusSet", { status: te(TICKET_STATUS_META, status) })}${outcome.childNote ? ` · ${outcome.childNote}` : ""}`;
    const refused = outcome.refusedChildren ?? [];
    // A child the workflow refused stays open, so the result is not a plain success.
    if (refused.length > 0) toast.warning(message, { description: refused.map((c) => `${c.ref}: ${tm(c.error)}`).join("\n") });
    else toast.success(message);
    return true;
  }

  const confirmPending = (p: PendingPayload) =>
    commitStatus(pendingDlg.status, async () => {
      const fd = new FormData();
      fd.set("id", String(ticket.id));
      fd.set("status", pendingDlg.status);
      fd.set("reason", p.reason);
      fd.set("bodyHtml", p.noteHtml);
      if (p.isInternal) fd.set("isInternal", "on");
      return { refusal: errorOf(await setTicketPending(fd)) };
    });

  const confirmResolution = (p: ResolutionPayload) =>
    commitStatus(resDlg.status, async () => {
      const fd = new FormData();
      fd.set("id", String(ticket.id));
      fd.set("status", resDlg.status);
      if (p.code) fd.set("code", p.code);
      fd.set("bodyHtml", p.noteHtml);
      if (p.isInternal) fd.set("isInternal", "on");
      if (p.resolveChildren) fd.set("resolveChildren", "on");
      const res = await setTicketResolution(fd);
      const refusedChildren = res.refusedChildren ?? [];
      return {
        refusal: errorOf(res),
        refusedChildren,
        childNote: childNoteOf(t, res.childrenResolved ?? 0, refusedChildren.length),
      };
    });

  // ── Sable triage suggestions (inline, per field) ──
  const [sugg, setSugg] = useState<Extract<TriageState, { ok: true }> | null>(null);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const triageStarted = useRef(false);
  useEffect(() => {
    if (!aiEnabled || aiTeaser || !triageEnabled || triageStarted.current) return;
    triageStarted.current = true;
    // Fetch (not a server action) so it never blocks an edit.
    fetch(`/api/ai/triage?ticketId=${ticket.id}`)
      .then((r) => r.json())
      .then((res: TriageState) => { if (res?.ok) setSugg(res); })
      .catch(() => {});
  }, [aiEnabled, aiTeaser, triageEnabled, ticket.id]);

  function suggestionFor(k: PropertyKey): Suggestion | null {
    if (!sugg || dismissed.has(k)) return null;
    const flagged = sugg.flagged ?? [];
    if (k === "priority") {
      if (values.priority === sugg.priority) return null;
      if (values.priority === "MEDIUM" || flagged.includes("priority")) return { value: sugg.priority, label: te(PRIORITY_META, sugg.priority) };
      return null;
    }
    if (k === "type") {
      if (values.type === sugg.type) return null;
      if (values.type === "INCIDENT" || flagged.includes("type")) return { value: sugg.type, label: te(TICKET_TYPE_META, sugg.type) };
      return null;
    }
    if (k === "impact") {
      if (values.impact === sugg.impact) return null;
      if (values.impact === "MEDIUM" || flagged.includes("impact")) return { value: sugg.impact, label: te(LEVEL_META, sugg.impact) };
      return null;
    }
    if (k === "urgency") {
      if (values.urgency === sugg.urgency) return null;
      if (values.urgency === "MEDIUM" || flagged.includes("urgency")) return { value: sugg.urgency, label: te(LEVEL_META, sugg.urgency) };
      return null;
    }
    if (k === "groupId") {
      if (!sugg.groupId || values.groupId === sugg.groupId) return null;
      if (values.groupId === "none" || flagged.includes("groupId")) return { value: sugg.groupId, label: groupName(sugg.groupId) };
      return null;
    }
    if (k === "categoryId") {
      if (!sugg.categoryId || values.categoryId === sugg.categoryId) return null;
      if (values.categoryId === "none" || flagged.includes("categoryId")) return { value: sugg.categoryId, label: catName(sugg.categoryId) };
      return null;
    }
    if (k === "serviceId") {
      if (!sugg.serviceId || values.serviceId === sugg.serviceId) return null;
      if (values.serviceId === "none" || flagged.includes("serviceId")) return { value: sugg.serviceId, label: svcName(sugg.serviceId) };
      return null;
    }
    return null;
  }

  const prop = (k: PropertyKey, opts: ComboOption[], searchable = false, placeholder?: string) => {
    const suggestion = suggestionFor(k);
    return (
      <EditProp
        label={fieldLabel(k)}
        value={values[k]}
        options={opts}
        searchable={searchable}
        placeholder={placeholder}
        pending={saving.includes(k)}
        suggestion={suggestion}
        onChange={(v) => (k === "status" ? changeStatus(v) : editField(k, v))}
        onApply={() => suggestion && editField(k, suggestion.value)}
        onDismiss={() => setDismissed((s) => new Set(s).add(k))}
      />
    );
  };

  return (
    <div className="grid gap-3">
      {prop("status", statusOpts)}
      <PendingReasonDialog
        status={pendingDlg.status}
        open={pendingDlg.open}
        onOpenChange={(o) => setPendingDlg((s) => ({ ...s, open: o }))}
        onConfirm={confirmPending}
      />
      <ResolutionDialog
        status={resDlg.status}
        openChildCount={openChildCount}
        open={resDlg.open}
        onOpenChange={(o) => setResDlg((s) => ({ ...s, open: o }))}
        onConfirm={confirmResolution}
      />

      {/* Who owns it */}
      <div className="grid gap-3 border-t pt-3">
        {prop("assigneeId", assigneeOpts, true, tc("unassigned"))}
        {prop("groupId", groupOpts, true, t("form.noGroup"))}
      </div>

      {/* How severe it is */}
      <div className="grid gap-3 border-t pt-3">
        {prop("priority", prioOpts)}
        <div className="grid grid-cols-2 gap-3">
          {prop("impact", levelOpts)}
          {prop("urgency", levelOpts)}
        </div>
      </div>

      {/* How it is classified */}
      <div className="grid gap-3 border-t pt-3">
        {prop("type", typeOpts)}
        {prop("categoryId", catOpts, true, t("form.noCategory"))}
        {prop("serviceId", svcOpts, true, t("form.noService"))}
      </div>

      {/* Due date — lives with the rest of the properties */}
      <div className="grid gap-1.5 border-t pt-3">
        <span className="text-xs font-medium text-muted-foreground">{t("props.dueDate")}</span>
        <DueDatePicker ticketId={ticket.id} dueDate={ticket.dueDate} />
      </div>
    </div>
  );
}
