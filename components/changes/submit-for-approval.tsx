"use client";

import { useState, useTransition } from "react";
import { Loader2, Send } from "lucide-react";
import { toast } from "sonner";
import { submitChangeForApproval } from "@/lib/actions/changes";
import Link from "next/link";
import type { SubmitBlocker } from "@/lib/change-rules";
import { useServerMessage, useT } from "@/lib/i18n/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";

export function SubmitForApproval({
  changeId, isStandard, approverCount, missing,
}: {
  changeId: number;
  isStandard: boolean;
  approverCount: number;
  /** What the change still lacks before it can be submitted (see submitBlockerDetails). */
  missing: SubmitBlocker[];
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  // Set when an emergency change sits inside a change freeze and must say why it overrides it.
  const [freezeNotice, setFreezeNotice] = useState<string | null>(null);
  const t = useT("changes");
  const tc = useT("common");
  const tm = useServerMessage();

  if (missing.length > 0) {
    const labels = missing.map((m) => t(`submitField.${m.field}`));
    const separator = (i: number) => (i === 0 ? null : i === missing.length - 1 ? t("submit.and") : ", ");
    const joined = labels.map((l, i) => `${separator(i) ?? ""}${l}`).join("");
    return (
      <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1" title={t("submit.blocked", { items: joined })}>
        <Button type="button" size="sm" disabled>
          <Send className="size-3.5" /> {t("submit.button")}
        </Button>
        <span className="max-w-72 text-xs text-muted-foreground">
          {t.rich("submit.addFirst", {
            items: (
              <>
                {missing.map((m, i) => (
                  <span key={m.field}>
                    {separator(i)}
                    <Link href={m.href} className="font-medium text-foreground underline underline-offset-2">
                      {labels[i]}
                    </Link>
                  </span>
                ))}
              </>
            ),
          })}
        </span>
      </span>
    );
  }

  const description = isStandard
    ? t("submit.standardDescription")
    : approverCount > 0
      ? t("submit.seatedDescription")
      : t("submit.description");

  const submit = (justification: string) => {
    const formData = new FormData();
    formData.set("id", String(changeId));
    if (justification) formData.set("justification", justification);
    startTransition(async () => {
      const res = await submitChangeForApproval(formData);
      if (res.ok) {
        toast.success(t("submit.done"));
        setOpen(false);
      } else if (res.needsJustification) {
        setFreezeNotice(tm(res.error));
      } else {
        toast.error(tm(res.error));
        setOpen(false);
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="default" size="sm" aria-label={t("submit.button")} />}>
        <Send className="size-3.5" /> {t("submit.button")}
      </DialogTrigger>
      <DialogContent className="sm:max-w-sm">
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            submit(String(new FormData(event.currentTarget).get("justification") ?? "").trim());
          }}
        >
          <DialogHeader>
            <DialogTitle>{t("submit.confirmTitle")}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>
          {freezeNotice ? (
            <label className="grid gap-1.5 text-sm">
              <span className="text-amber-600 dark:text-amber-400">{freezeNotice}</span>
              <Textarea name="justification" required placeholder={t("submit.justificationPlaceholder")} />
            </label>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
              {tc("cancel")}
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? <Loader2 className="size-4 animate-spin" /> : null}
              {tc("submit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
