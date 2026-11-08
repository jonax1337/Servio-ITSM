"use client";

import { useState, useTransition } from "react";
import { Loader2, Pencil } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Combobox, type ComboOption } from "@/components/combobox";
import { bulkUpdateTickets } from "@/lib/actions/tickets";
import {
  BULK_CLEAR, BULK_STATUSES, buildBulkChanges, type BulkField, type BulkOutcome, type BulkSkip,
} from "@/lib/bulk-edit";
import { PRIORITIES, PRIORITY_META, TICKET_STATUS_META } from "@/lib/constants";
import { useEnumT, useServerMessage, useT } from "@/lib/i18n/client";
import type { Translator } from "@/lib/i18n/translate";

export type BulkEditOptions = {
  agents: ComboOption[];
  groups: ComboOption[];
  categories: ComboOption[];
};

type Patch = Partial<Record<BulkField, string>>;

const UNCHANGED = "";
const SHOWN_REASONS = 3;
const SHOWN_TICKETS = 3;

/** The one-line result, e.g. "3 tickets updated, 1 partially updated, 2 skipped" (mirrors lib/bulk-edit bulkSummary). */
function summaryOf(t: Translator<"tickets">, { updated, partial, skipped }: BulkOutcome): string {
  const figures = [
    [updated, "updated"],
    [partial.length, "partial"],
    [skipped.length, "skipped"],
  ] as const;
  const shown = figures.filter(([count]) => count > 0);
  if (shown.length === 0) return t("bulk.first.updated", { count: 0 });
  return shown.map(([count, what], i) => t(i === 0 ? `bulk.first.${what}` : `bulk.rest.${what}`, { count })).join(", ");
}

/** Refusals grouped by reason (mirrors lib/bulk-edit bulkSkipDetail), with each reason translated. */
function skipDetailOf(t: Translator<"tickets">, tm: (m: string) => string, skipped: readonly BulkSkip[]): string {
  const byReason = new Map<string, string[]>();
  for (const { ticket, reason } of skipped) byReason.set(reason, [...(byReason.get(reason) ?? []), ticket]);
  const shown = [...byReason].slice(0, SHOWN_REASONS).map(([reason, tickets]) => {
    const more = tickets.length - SHOWN_TICKETS;
    const list = tickets.slice(0, SHOWN_TICKETS).join(", ");
    return `${tm(reason)} (${more > 0 ? t("bulk.andMore", { list, count: more }) : list})`;
  });
  const hidden = byReason.size - SHOWN_REASONS;
  return hidden > 0 ? `${shown.join("; ")}; ${t("bulk.moreReasons", { count: hidden })}` : shown.join("; ");
}

function outcomeDetailOf(t: Translator<"tickets">, tm: (m: string) => string, { partial, skipped }: BulkOutcome): string {
  return [
    partial.length > 0 && t("bulk.partlyUpdatedDetail", { detail: skipDetailOf(t, tm, partial) }),
    skipped.length > 0 && t("bulk.skippedDetail", { detail: skipDetailOf(t, tm, skipped) }),
  ].filter(Boolean).join(". ");
}

/**
 * Sets several fields on the selected tickets in one go: status, priority, group,
 * assignee and category. Fields left on "Don't change" are not touched.
 */
export function BulkEditDialog({
  ticketIds,
  options,
  onApplied,
}: {
  ticketIds: number[];
  options: BulkEditOptions;
  onApplied: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [patch, setPatch] = useState<Patch>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, startApply] = useTransition();
  const t = useT("tickets");
  const tc = useT("common");
  const te = useEnumT();
  const tm = useServerMessage();
  const withUnchanged = (clearLabel: string, options: ComboOption[]): ComboOption[] => [
    { value: UNCHANGED, label: t("bulk.dontChange") },
    { value: BULK_CLEAR, label: clearLabel },
    ...options,
  ];
  const set = (field: BulkField, value: string) => {
    setError(null);
    setPatch((p) => ({ ...p, [field]: value }));
  };
  /** Clicking the chosen chip again takes the field back to "Don't change". */
  const toggle = (field: BulkField, value: string) => set(field, patch[field] === value ? UNCHANGED : value);

  function apply() {
    const fd = new FormData();
    fd.set("ids", ticketIds.join(","));
    fd.set("patch", JSON.stringify(patch));
    startApply(async () => {
      const failWith = (message: string) => {
        setError(message);
        toast.error(message);
      };
      let result: Awaited<ReturnType<typeof bulkUpdateTickets>>;
      try {
        result = await bulkUpdateTickets(fd);
      } catch {
        return failWith(t("bulk.requestFailed"));
      }
      if (!result.ok) return failWith(result.error ? tm(result.error) : t("bulk.requestFailed"));
      const summary = summaryOf(t, result);
      if (result.skipped.length === 0 && result.partial.length === 0) toast.success(summary);
      else toast.warning(summary, { description: outcomeDetailOf(t, tm, result) });
      setOpen(false);
      setPatch({});
      onApplied();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button type="button" size="sm" variant="outline" />}>
        <Pencil className="size-4" /> {t("bulk.editFields")}
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("bulk.title", { count: ticketIds.length })}</DialogTitle>
          <DialogDescription>{t("bulk.description")}</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <ChipField
            label={tc("status")}
            value={patch.status}
            onToggle={(v) => toggle("status", v)}
            choices={te.options(TICKET_STATUS_META, BULK_STATUSES)}
          />
          <ChipField
            label={tc("priority")}
            value={patch.priority}
            onToggle={(v) => toggle("priority", v)}
            choices={te.options(PRIORITY_META, PRIORITIES)}
          />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <ComboField label={tc("group")} value={patch.groupId} onChange={(v) => set("groupId", v)} options={withUnchanged(t("form.noGroup"), options.groups)} />
            <ComboField label={tc("assignee")} value={patch.assigneeId} onChange={(v) => set("assigneeId", v)} options={withUnchanged(tc("unassigned"), options.agents)} />
            <ComboField label={tc("category")} value={patch.categoryId} onChange={(v) => set("categoryId", v)} options={withUnchanged(t("form.noCategory"), options.categories)} />
          </div>
        </div>

        {error ? (
          <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        ) : null}

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => setOpen(false)}>{tc("cancel")}</Button>
          <Button type="button" onClick={apply} disabled={pending || buildBulkChanges(patch).length === 0}>
            {pending ? <Loader2 className="size-4 animate-spin" /> : null}
            {t("bulk.applyTo", { count: ticketIds.length })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ChipField({
  label,
  choices,
  value,
  onToggle,
}: {
  label: string;
  choices: { value: string; label: string }[];
  value: string | undefined;
  onToggle: (value: string) => void;
}) {
  return (
    <div className="grid gap-1.5" role="group" aria-label={label}>
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <div className="flex flex-wrap gap-1.5">
        {choices.map((c) => (
          <button
            key={c.value}
            type="button"
            aria-pressed={value === c.value}
            onClick={() => onToggle(c.value)}
            className={cn(
              "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
              value === c.value
                ? "border-primary/40 bg-primary/10 text-primary"
                : "text-muted-foreground hover:border-primary/40 hover:text-foreground",
            )}
          >
            {c.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function ComboField({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: ComboOption[];
  value: string | undefined;
  onChange: (value: string) => void;
}) {
  const t = useT("tickets");
  return (
    <div className="grid gap-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <Combobox
        options={options}
        value={value ?? UNCHANGED}
        onChange={onChange}
        size="sm"
        searchPlaceholder={t("props.searchField", { field: label })}
      />
    </div>
  );
}
