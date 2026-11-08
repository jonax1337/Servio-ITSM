"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import {
  createProblemFromTickets, listRaiseProblemFields, listSimilarIncidents, type SimilarIncident,
} from "@/lib/actions/problems";
import { FormCustomFields } from "@/components/custom-fields/form-custom-fields";
import type { CustomFieldDef } from "@/lib/custom-fields";
import { problemRef } from "@/lib/constants";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { useServerMessage, useT } from "@/lib/i18n/client";

type ProblemDraft = { title: string; description: string };

/**
 * Raises a problem for the given tickets and lands on it. For a single incident
 * (`offerSimilar`) the dialog also lists similar incidents to link in the same step.
 */
export function RaiseProblemDialog({
  open, onOpenChange, ticketIds, draft, offerSimilar = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The tickets to link; the first one is the incident the dialog was opened from. */
  ticketIds: number[];
  draft: ProblemDraft;
  offerSimilar?: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        {/* The form only mounts while open, so its fields reset to the draft on every open. */}
        {open ? <ProblemForm ticketIds={ticketIds} draft={draft} offerSimilar={offerSimilar} onClose={() => onOpenChange(false)} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function ProblemForm({
  ticketIds, draft, offerSimilar, onClose,
}: {
  ticketIds: number[];
  draft: ProblemDraft;
  offerSimilar: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const [title, setTitle] = useState(draft.title);
  const [description, setDescription] = useState(draft.description);
  const [similar, setSimilar] = useState<SimilarIncident[] | null>(offerSimilar ? null : []);
  const [chosen, setChosen] = useState<ReadonlySet<number>>(new Set());
  const [fields, setFields] = useState<CustomFieldDef[]>([]);
  const [pending, startCreate] = useTransition();
  const t = useT("tickets");
  const tc = useT("common");
  const tm = useServerMessage();

  const primaryId = ticketIds[0];
  useEffect(() => {
    if (!offerSimilar) return;
    let current = true;
    listSimilarIncidents(primaryId)
      .then((found) => current && setSimilar(found))
      .catch(() => current && setSimilar([]));
    return () => { current = false; };
  }, [offerSimilar, primaryId]);

  // The problem inherits its traits from every linked ticket, so the fields it needs follow the chosen incidents.
  const linkedKey = [...ticketIds, ...chosen].join(",");
  useEffect(() => {
    let current = true;
    listRaiseProblemFields(linkedKey.split(",").map(Number))
      .then((found) => current && setFields(found))
      .catch(() => current && setFields([]));
    return () => { current = false; };
  }, [linkedKey]);

  const toggle = (id: number) =>
    setChosen((set) => {
      const next = new Set(set);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  function create(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    fd.set("title", title);
    fd.set("description", description);
    fd.set("ticketIds", [...ticketIds, ...chosen].join(","));
    startCreate(async () => {
      const result = await createProblemFromTickets(fd);
      if (!result.ok) {
        toast.error(tm(result.error));
        return;
      }
      const skipped = result.skipped > 0 ? ` ${t("raiseProblem.skipped", { count: result.skipped })}` : "";
      toast.success(`${t("raiseProblem.created", { ref: problemRef(result.problemId), count: result.linked })}${skipped}`);
      router.push(`/problems/${result.problemId}`);
    });
  }

  return (
    <form onSubmit={create} className="grid grid-cols-[minmax(0,1fr)] gap-4">
      <DialogHeader>
        <DialogTitle>{t("raiseProblem.title")}</DialogTitle>
        <DialogDescription>
          {ticketIds.length > 1
            ? t("raiseProblem.descriptionMany", { count: ticketIds.length })
            : t("raiseProblem.descriptionOne")}
        </DialogDescription>
      </DialogHeader>

      <div className="grid gap-1.5">
        <Label htmlFor="problem-title">{tc("title")}</Label>
        <Input id="problem-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t("raiseProblem.titlePlaceholder")} required minLength={3} autoFocus />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="problem-description">{tc("description")}</Label>
        <Textarea id="problem-description" value={description} onChange={(e) => setDescription(e.target.value)} className="min-h-24" />
      </div>

      {fields.length > 0 ? (
        <fieldset className="grid min-w-0 gap-1.5">
          <legend className="mb-1 text-sm font-medium">{t("raiseProblem.requiredDetails")}</legend>
          <FormCustomFields defs={fields} disabled={pending} />
        </fieldset>
      ) : null}

      {offerSimilar ? <SimilarIncidents similar={similar} chosen={chosen} onToggle={toggle} /> : null}

      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onClose} disabled={pending}>{tc("cancel")}</Button>
        <Button type="submit" disabled={pending || title.trim().length < 3}>
          {pending ? <Loader2 className="size-4 animate-spin" /> : null}
          {t("raiseProblem.title")}
        </Button>
      </DialogFooter>
    </form>
  );
}

function SimilarIncidents({
  similar, chosen, onToggle,
}: {
  similar: SimilarIncident[] | null;
  chosen: ReadonlySet<number>;
  onToggle: (id: number) => void;
}) {
  const t = useT("tickets");
  if (similar === null) {
    return <p className="text-xs text-muted-foreground">{t("raiseProblem.lookingSimilar")}</p>;
  }
  if (similar.length === 0) return null;
  return (
    <fieldset className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-1.5">
      <legend className="mb-1 text-sm font-medium">{t("raiseProblem.alsoLink")}</legend>
      {similar.map((s) => (
        <label key={s.id} className="flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-sm has-[[data-checked]]:border-primary/40 has-[[data-checked]]:bg-primary/5">
          <Checkbox checked={chosen.has(s.id)} onCheckedChange={() => onToggle(s.id)} aria-label={t("raiseProblem.linkRef", { ref: s.ref })} />
          <span className="font-mono text-xs text-muted-foreground">{s.ref}</span>
          <span className="min-w-0 flex-1 truncate">{s.title}</span>
          <span className="text-xs tabular-nums text-muted-foreground">{Math.round(s.score * 100)}%</span>
        </label>
      ))}
    </fieldset>
  );
}

/** "Create problem from this incident" as a button, for pages that have no actions menu. */
export function RaiseProblemButton({ ticketId, draft }: { ticketId: number; draft: ProblemDraft }) {
  const [open, setOpen] = useState(false);
  const t = useT("tickets");
  return (
    <>
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
        <TriangleAlert className="size-4" /> {t("raiseProblem.fromIncident")}
      </Button>
      <RaiseProblemDialog open={open} onOpenChange={setOpen} ticketIds={[ticketId]} draft={draft} offerSimilar />
    </>
  );
}
