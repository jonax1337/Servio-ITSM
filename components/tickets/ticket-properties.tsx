"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Loader2, X } from "lucide-react";
import { SableMark } from "@/components/sable-mark";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { updateTicketField, setTicketResolution, setTicketPending } from "@/lib/actions/tickets";
import { type TriageState } from "@/lib/actions/ai";
import { Button } from "@/components/ui/button";
import { Combobox, type ComboOption } from "@/components/combobox";
import { PendingReasonDialog } from "@/components/tickets/pending-reason-dialog";
import { ResolutionDialog } from "@/components/tickets/resolution-dialog";
import { DueDatePicker } from "@/components/tickets/due-date-picker";
import { childResolutionMessage, refusedChildrenDetail, type RefusedChild } from "@/lib/ticket-hierarchy-rules";
import {
  TICKET_STATUSES,
  TICKET_TYPES,
  PRIORITIES,
  IMPACT_URGENCY,
  PENDING_REASONS,
  TICKET_STATUS_META,
  TICKET_TYPE_META,
  PRIORITY_META,
  LEVEL_META,
} from "@/lib/constants";
import type { FormOptions } from "@/lib/data/options";

/** The refusal message of a ticket action result, or null when it went through. */
const errorOf = (res: { ok: boolean; error?: string }) => (res.ok ? null : res.error ?? "Could not save changes.");

/** Editable fields staged in the local draft (saved together via "Save changes"). */
type DraftKey = "status" | "type" | "priority" | "impact" | "urgency" | "assigneeId" | "groupId" | "categoryId" | "serviceId";
const DRAFT_KEYS: DraftKey[] = ["status", "type", "priority", "impact", "urgency", "assigneeId", "groupId", "categoryId", "serviceId"];

/** Extra data captured for status changes that need a note (resolution / pending). */
type StatusPayload = { code?: string | null; reason?: string; noteHtml: string; isInternal: boolean; resolveChildren?: boolean } | null;

function initials(s: string) {
  return s.split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase();
}

type Suggestion = { value: string; label: string };

/** A single property: staged combobox with dirty highlight + optional inline Sable suggestion. */
function EditProp({
  label, value, options, searchable, placeholder, dirty, pending, suggestion, onChange, onApply, onDismiss,
}: {
  label: string;
  value: string;
  options: ComboOption[];
  searchable?: boolean;
  placeholder?: string;
  dirty: boolean;
  pending: boolean;
  suggestion: Suggestion | null;
  onChange: (v: string) => void;
  onApply: () => void;
  onDismiss: () => void;
}) {
  return (
    <div className="grid gap-1.5">
      <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        {label}
        {dirty ? <span className="size-1.5 rounded-full bg-amber-500" title="Unsaved change" /> : null}
      </span>
      <Combobox
        options={options}
        value={value}
        pending={pending}
        placeholder={placeholder}
        searchPlaceholder={searchable ? `Search ${label.toLowerCase()}…` : "Filter…"}
        onChange={onChange}
        className={cn(
          suggestion && "border-sable/40 ring-2 ring-sable/30",
          !suggestion && dirty && "border-amber-500/40 ring-2 ring-amber-500/40",
        )}
      />
      {suggestion ? (
        <div className="sable-accent-border flex items-center gap-1 rounded-md border bg-sable-muted/50 px-2 py-1">
          <SableMark className="size-3.5 shrink-0 text-sable" />
          <span className="min-w-0 flex-1 truncate text-xs text-foreground/80">{suggestion.label}</span>
          <Button type="button" size="xs" className="h-5 shrink-0 bg-sable px-1.5 text-sable-foreground hover:bg-sable/90" onClick={onApply}>Apply</Button>
          <Button type="button" size="xs" variant="ghost" className="h-5 shrink-0 px-1.5 text-muted-foreground" onClick={onDismiss}>
            Dismiss
          </Button>
        </div>
      ) : null}
    </div>
  );
}

export function TicketProperties({
  ticket,
  options,
  aiEnabled = false,
  aiTeaser = false,
  triageEnabled = false,
  allowedStatuses,
  openChildCount = 0,
}: {
  ticket: {
    id: number;
    status: string;
    type: string;
    priority: string;
    impact: string;
    urgency: string;
    assigneeId: string | null;
    groupId: string | null;
    categoryId: string | null;
    serviceId: string | null;
    dueDate: Date | null;
  };
  options: FormOptions;
  aiEnabled?: boolean;
  aiTeaser?: boolean;
  triageEnabled?: boolean;
  /** Statuses reachable from the current one under the workflow; others grey out. */
  allowedStatuses?: string[];
  /** Child tickets still open — resolving this ticket can take them along. */
  openChildCount?: number;
}) {
  // ── Options ──
  const allowedSet = allowedStatuses ? new Set(allowedStatuses) : null;
  const statusOpts: ComboOption[] = TICKET_STATUSES.map((s) => ({
    value: s, label: TICKET_STATUS_META[s].label, tone: TICKET_STATUS_META[s].tone, icon: TICKET_STATUS_META[s].icon,
    disabled: allowedSet ? !allowedSet.has(s) : false,
    disabledReason: "Not allowed from the current status by the workflow.",
  }));
  const prioOpts: ComboOption[] = PRIORITIES.map((p) => ({
    value: p, label: PRIORITY_META[p].label, tone: PRIORITY_META[p].tone, icon: PRIORITY_META[p].icon,
  }));
  const levelOpts: ComboOption[] = IMPACT_URGENCY.map((l) => ({ value: l, label: LEVEL_META[l].label, tone: LEVEL_META[l].tone }));
  const typeOpts: ComboOption[] = TICKET_TYPES.map((t) => ({
    value: t, label: TICKET_TYPE_META[t].label, tone: TICKET_TYPE_META[t].tone, icon: TICKET_TYPE_META[t].icon,
  }));
  const none = (label: string): ComboOption => ({ value: "none", label });
  const groupOpts: ComboOption[] = [none("No group"), ...options.groups.map((g) => ({ value: g.id, label: g.name }))];
  const catOpts: ComboOption[] = [none("No category"), ...options.categories.map((c) => ({ value: c.id, label: c.name }))];
  const svcOpts: ComboOption[] = [none("No service"), ...options.services.map((s) => ({ value: s.id, label: s.name }))];
  const groupName = (id: string) => options.groups.find((g) => g.id === id)?.name ?? id;
  const catName = (id: string) => options.categories.find((c) => c.id === id)?.name ?? id;
  const svcName = (id: string) => options.services.find((s) => s.id === id)?.name ?? id;

  // ── Draft state (staged edits) vs the saved ticket baseline ──
  const base: Record<DraftKey, string> = {
    status: ticket.status,
    type: ticket.type,
    priority: ticket.priority,
    impact: ticket.impact,
    urgency: ticket.urgency,
    assigneeId: ticket.assigneeId ?? "none",
    groupId: ticket.groupId ?? "none",
    categoryId: ticket.categoryId ?? "none",
    serviceId: ticket.serviceId ?? "none",
  };
  const [draft, setDraft] = useState<Record<DraftKey, string>>(base);
  const [statusPayload, setStatusPayload] = useState<StatusPayload>(null);
  const [saving, startSaving] = useTransition();
  const savingRef = useRef(false);

  // Sync the draft when the ticket changes externally. Skipped mid-save.
  useEffect(() => {
    if (savingRef.current) return;
    setDraft({
      status: ticket.status,
      type: ticket.type,
      priority: ticket.priority,
      impact: ticket.impact,
      urgency: ticket.urgency,
      assigneeId: ticket.assigneeId ?? "none",
      groupId: ticket.groupId ?? "none",
      categoryId: ticket.categoryId ?? "none",
      serviceId: ticket.serviceId ?? "none",
    });
    setStatusPayload(null);
  }, [ticket.status, ticket.type, ticket.priority, ticket.impact, ticket.urgency, ticket.assigneeId, ticket.groupId, ticket.categoryId, ticket.serviceId]);

  const dirtyKeys = DRAFT_KEYS.filter((k) => draft[k] !== base[k]);
  const anyDirty = dirtyKeys.length > 0;

  // Assignee must be a member of the chosen group (any agent when there's no
  // group). The currently-selected assignee is always kept so it still shows.
  const memberIds = draft.groupId !== "none" ? new Set(options.groupMembers[draft.groupId] ?? []) : null;
  const assigneeOpts: ComboOption[] = [
    none("Unassigned"),
    ...options.agents
      .filter((a) => !memberIds || memberIds.has(a.id) || a.id === draft.assigneeId)
      .map((a) => ({ value: a.id, label: a.name ?? a.email, avatar: initials(a.name ?? a.email), hint: a.email })),
  ];

  function setField(k: DraftKey, v: string) {
    setDraft((d) => {
      const next = { ...d, [k]: v };
      // Changing to a group the current assignee isn't in clears the assignee.
      if (k === "groupId" && v !== "none" && next.assigneeId !== "none") {
        const members = new Set(options.groupMembers[v] ?? []);
        if (!members.has(next.assigneeId)) next.assigneeId = "none";
      }
      return next;
    });
  }

  function discard() {
    setDraft(base);
    setStatusPayload(null);
    setDismissed(new Set());
  }

  function saveChanges() {
    // Persist groupId before assigneeId so the server validates the assignee
    // against the NEW group, not the old one.
    const saveRank = (k: DraftKey) => (k === "groupId" ? 0 : k === "assigneeId" ? 2 : 1);
    const nonStatus = dirtyKeys
      .filter((k) => k !== "status")
      .sort((a, b) => saveRank(a) - saveRank(b))
      .map((field) => ({ field, value: draft[field] }));
    const statusChanged = draft.status !== base.status;
    if (nonStatus.length === 0 && !statusChanged) return;
    const newStatus = draft.status;
    const payload = statusPayload;
    savingRef.current = true;
    startSaving(async () => {
      let refusal: string | null = null;
      let childNote: string | null = null;
      let refusedChildren: RefusedChild[] = [];
      try {
        for (const c of nonStatus) {
          const fd = new FormData();
          fd.set("id", String(ticket.id));
          fd.set("field", c.field);
          fd.set("value", c.value);
          refusal = refusal ?? errorOf(await updateTicketField(fd));
        }
        if (statusChanged && !refusal) {
          const fd = new FormData();
          fd.set("id", String(ticket.id));
          if (newStatus === "PENDING" || newStatus === "ON_HOLD") {
            fd.set("status", newStatus);
            fd.set("reason", payload?.reason ?? PENDING_REASONS[0]);
            fd.set("bodyHtml", payload?.noteHtml ?? "");
            if (payload?.isInternal) fd.set("isInternal", "on");
            refusal = errorOf(await setTicketPending(fd));
          } else if (newStatus === "RESOLVED" || newStatus === "CLOSED" || newStatus === "CANCELLED") {
            fd.set("status", newStatus);
            if (payload?.code) fd.set("code", payload.code);
            fd.set("bodyHtml", payload?.noteHtml ?? "");
            if (payload?.isInternal) fd.set("isInternal", "on");
            if (payload?.resolveChildren) fd.set("resolveChildren", "on");
            const res = await setTicketResolution(fd);
            refusal = errorOf(res);
            refusedChildren = res.refusedChildren ?? [];
            childNote = childResolutionMessage(res.childrenResolved ?? 0, refusedChildren.length);
          } else {
            fd.set("field", "status");
            fd.set("value", newStatus);
            refusal = errorOf(await updateTicketField(fd));
          }
        }
        if (refusal) {
          toast.error(refusal);
          // A refused status stays unsaved: show the real status again instead of a pending change.
          if (statusChanged) {
            setDraft((d) => ({ ...d, status: base.status }));
            setStatusPayload(null);
          }
          return;
        }
        const count = nonStatus.length + (statusChanged ? 1 : 0);
        const message = `Saved ${count} change${count > 1 ? "s" : ""}${childNote ? ` · ${childNote}` : ""}`;
        // A child the workflow refused stays open, so the result is not a plain success.
        if (refusedChildren.length > 0) toast.warning(message, { description: refusedChildrenDetail(refusedChildren) });
        else toast.success(message);
        setStatusPayload(null);
      } catch {
        toast.error("Could not save changes.");
      } finally {
        savingRef.current = false;
      }
    });
  }

  // ── Status pick → stage directly, or open a dialog to capture the note first ──
  const [pendingDlg, setPendingDlg] = useState<{ open: boolean; status: string }>({ open: false, status: "PENDING" });
  const [resDlg, setResDlg] = useState<{ open: boolean; status: string }>({ open: false, status: "RESOLVED" });

  const changeStatus = (v: string) => {
    if (v === draft.status) return;
    if (v === "PENDING" || v === "ON_HOLD") return setPendingDlg({ open: true, status: v });
    if (v === "RESOLVED" || v === "CLOSED" || v === "CANCELLED") return setResDlg({ open: true, status: v });
    setField("status", v);
    setStatusPayload(null);
  };

  // ── Sable triage suggestions (inline, per field) ──
  const [sugg, setSugg] = useState<Extract<TriageState, { ok: true }> | null>(null);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const triageStarted = useRef(false);
  useEffect(() => {
    if (!aiEnabled || aiTeaser || !triageEnabled || triageStarted.current) return;
    triageStarted.current = true;
    // Fetch (not a server action) so it never blocks Save changes.
    fetch(`/api/ai/triage?ticketId=${ticket.id}`)
      .then((r) => r.json())
      .then((res: TriageState) => { if (res?.ok) setSugg(res); })
      .catch(() => {});
  }, [aiEnabled, aiTeaser, triageEnabled, ticket.id]);

  function suggestionFor(k: DraftKey): Suggestion | null {
    if (!sugg || dismissed.has(k)) return null;
    const flagged = sugg.flagged ?? [];
    if (k === "priority") {
      if (draft.priority === sugg.priority) return null;
      if (base.priority === "MEDIUM" || flagged.includes("priority")) return { value: sugg.priority, label: PRIORITY_META[sugg.priority].label };
      return null;
    }
    if (k === "type") {
      if (draft.type === sugg.type) return null;
      if (base.type === "INCIDENT" || flagged.includes("type")) return { value: sugg.type, label: TICKET_TYPE_META[sugg.type].label };
      return null;
    }
    if (k === "impact") {
      if (draft.impact === sugg.impact) return null;
      if (base.impact === "MEDIUM" || flagged.includes("impact")) return { value: sugg.impact, label: LEVEL_META[sugg.impact].label };
      return null;
    }
    if (k === "urgency") {
      if (draft.urgency === sugg.urgency) return null;
      if (base.urgency === "MEDIUM" || flagged.includes("urgency")) return { value: sugg.urgency, label: LEVEL_META[sugg.urgency].label };
      return null;
    }
    if (k === "groupId") {
      if (!sugg.groupId || draft.groupId === sugg.groupId) return null;
      if (base.groupId === "none" || flagged.includes("groupId")) return { value: sugg.groupId, label: groupName(sugg.groupId) };
      return null;
    }
    if (k === "categoryId") {
      if (!sugg.categoryId || draft.categoryId === sugg.categoryId) return null;
      if (base.categoryId === "none" || flagged.includes("categoryId")) return { value: sugg.categoryId, label: catName(sugg.categoryId) };
      return null;
    }
    if (k === "serviceId") {
      if (!sugg.serviceId || draft.serviceId === sugg.serviceId) return null;
      if (base.serviceId === "none" || flagged.includes("serviceId")) return { value: sugg.serviceId, label: svcName(sugg.serviceId) };
      return null;
    }
    return null;
  }

  const prop = (k: DraftKey, label: string, opts: ComboOption[], searchable = false, placeholder?: string) => {
    const suggestion = suggestionFor(k);
    return (
      <EditProp
        label={label}
        value={draft[k]}
        options={opts}
        searchable={searchable}
        placeholder={placeholder}
        dirty={draft[k] !== base[k]}
        pending={saving && draft[k] !== base[k]}
        suggestion={suggestion}
        onChange={(v) => setField(k, v)}
        onApply={() => suggestion && setField(k, suggestion.value)}
        onDismiss={() => setDismissed((s) => new Set(s).add(k))}
      />
    );
  };

  const statusDirty = draft.status !== base.status;

  return (
    <div className="grid gap-3">
      {/* Status — staged like the rest */}
      <div className="grid gap-1.5">
        <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          Status
          {statusDirty ? <span className="size-1.5 rounded-full bg-amber-500" title="Unsaved change" /> : null}
        </span>
        <Combobox
          options={statusOpts}
          value={draft.status}
          pending={saving && statusDirty}
          onChange={changeStatus}
          className={statusDirty ? "border-amber-500/40 ring-2 ring-amber-500/40" : undefined}
        />
      </div>
      <PendingReasonDialog
        status={pendingDlg.status}
        open={pendingDlg.open}
        onOpenChange={(o) => setPendingDlg((s) => ({ ...s, open: o }))}
        onConfirm={(p) => {
          setDraft((d) => ({ ...d, status: pendingDlg.status }));
          setStatusPayload({ reason: p.reason, noteHtml: p.noteHtml, isInternal: p.isInternal });
          setPendingDlg((s) => ({ ...s, open: false }));
        }}
      />
      <ResolutionDialog
        status={resDlg.status}
        openChildCount={openChildCount}
        open={resDlg.open}
        onOpenChange={(o) => setResDlg((s) => ({ ...s, open: o }))}
        onConfirm={(p) => {
          setDraft((d) => ({ ...d, status: resDlg.status }));
          setStatusPayload({ code: p.code, noteHtml: p.noteHtml, isInternal: p.isInternal, resolveChildren: p.resolveChildren });
          setResDlg((s) => ({ ...s, open: false }));
        }}
      />

      {/* Who owns it */}
      <div className="grid gap-3 border-t pt-3">
        {prop("assigneeId", "Assignee", assigneeOpts, true, "Unassigned")}
        {prop("groupId", "Group", groupOpts, true, "No group")}
      </div>

      {/* How severe it is */}
      <div className="grid gap-3 border-t pt-3">
        {prop("priority", "Priority", prioOpts)}
        <div className="grid grid-cols-2 gap-3">
          {prop("impact", "Impact", levelOpts)}
          {prop("urgency", "Urgency", levelOpts)}
        </div>
      </div>

      {/* How it's classified */}
      <div className="grid gap-3 border-t pt-3">
        {prop("type", "Type", typeOpts)}
        {prop("categoryId", "Category", catOpts, true, "No category")}
        {prop("serviceId", "Service", svcOpts, true, "No service")}
      </div>

      {/* Due date — lives with the rest of the properties */}
      <div className="grid gap-1.5 border-t pt-3">
        <span className="text-xs font-medium text-muted-foreground">Due date</span>
        <DueDatePicker ticketId={ticket.id} dueDate={ticket.dueDate} />
      </div>

      {/* Save bar — only when there are staged changes */}
      {anyDirty ? (
        // pr-20 keeps the Discard button clear of the floating Sable launcher (bottom-right).
        <div className="sticky bottom-0 -mx-4 flex items-center gap-1.5 border-t bg-card/95 pt-2.5 pb-1 pl-4 pr-20 backdrop-blur sm:-mx-6 sm:pl-6">
          <Button type="button" size="sm" className="flex-1" onClick={saveChanges} disabled={saving}>
            {saving ? <Loader2 className="size-3.5 animate-spin" /> : null}
            Save changes
          </Button>
          <Button type="button" size="icon-sm" variant="ghost" onClick={discard} disabled={saving} aria-label="Discard changes" title="Discard changes">
            <X className="size-4" />
          </Button>
        </div>
      ) : null}
    </div>
  );
}
