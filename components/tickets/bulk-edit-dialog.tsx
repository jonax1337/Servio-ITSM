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
import { BULK_CLEAR, BULK_STATUSES, bulkSummary, buildBulkChanges, type BulkField } from "@/lib/bulk-edit";
import { PRIORITIES, PRIORITY_META, TICKET_STATUS_META } from "@/lib/constants";

export type BulkEditOptions = {
  agents: ComboOption[];
  groups: ComboOption[];
  categories: ComboOption[];
};

type Patch = Partial<Record<BulkField, string>>;

const UNCHANGED = "";
const withUnchanged = (clearLabel: string, options: ComboOption[]): ComboOption[] => [
  { value: UNCHANGED, label: "Don't change" },
  { value: BULK_CLEAR, label: clearLabel },
  ...options,
];

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
  const [pending, startApply] = useTransition();

  const noun = ticketIds.length === 1 ? "ticket" : "tickets";
  const set = (field: BulkField, value: string) => setPatch((p) => ({ ...p, [field]: value }));
  /** Clicking the chosen chip again takes the field back to "Don't change". */
  const toggle = (field: BulkField, value: string) => set(field, patch[field] === value ? UNCHANGED : value);

  function apply() {
    const fd = new FormData();
    fd.set("ids", ticketIds.join(","));
    fd.set("patch", JSON.stringify(patch));
    startApply(async () => {
      const result = await bulkUpdateTickets(fd);
      const summary = bulkSummary(result);
      if (result.failed === 0) toast.success(summary);
      else toast.error(summary, { description: result.error });
      setOpen(false);
      setPatch({});
      onApplied();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button type="button" size="sm" variant="outline" />}>
        <Pencil className="size-4" /> Edit fields…
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit {ticketIds.length} {noun}</DialogTitle>
          <DialogDescription>Set any combination of fields. Fields left alone stay as they are.</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <ChipField
            label="Status"
            value={patch.status}
            onToggle={(v) => toggle("status", v)}
            choices={BULK_STATUSES.map((s) => ({ value: s, label: TICKET_STATUS_META[s].label }))}
          />
          <ChipField
            label="Priority"
            value={patch.priority}
            onToggle={(v) => toggle("priority", v)}
            choices={PRIORITIES.map((p) => ({ value: p, label: PRIORITY_META[p].label }))}
          />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <ComboField label="Group" value={patch.groupId} onChange={(v) => set("groupId", v)} options={withUnchanged("No group", options.groups)} />
            <ComboField label="Assignee" value={patch.assigneeId} onChange={(v) => set("assigneeId", v)} options={withUnchanged("Unassigned", options.agents)} />
            <ComboField label="Category" value={patch.categoryId} onChange={(v) => set("categoryId", v)} options={withUnchanged("No category", options.categories)} />
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
          <Button type="button" onClick={apply} disabled={pending || buildBulkChanges(patch).length === 0}>
            {pending ? <Loader2 className="size-4 animate-spin" /> : null}
            Apply to {ticketIds.length} {noun}
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
  return (
    <div className="grid gap-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <Combobox
        options={options}
        value={value ?? UNCHANGED}
        onChange={onChange}
        size="sm"
        searchPlaceholder={`Search ${label.toLowerCase()}…`}
      />
    </div>
  );
}
