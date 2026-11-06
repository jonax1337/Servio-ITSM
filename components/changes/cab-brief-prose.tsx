"use client";

import { useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { SableMark } from "@/components/sable-mark";
import { summarizeChangeForCab } from "@/lib/actions/change-copilot";
import { AI_TEASER_MESSAGE } from "@/lib/constants";

/** The optional AI paragraph of the CAB brief, generated on request. */
export function CabBriefProse({ changeId, teaser }: { changeId: number; teaser: boolean }) {
  const [text, setText] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function generate() {
    if (teaser) return void toast.info(AI_TEASER_MESSAGE);
    startTransition(async () => {
      const result = await summarizeChangeForCab(changeId);
      if (result.ok) setText(result.text);
      else toast.error(result.error);
    });
  }

  return (
    <div className="mt-4 rounded-lg border border-sable/25 bg-sable-muted/40 p-3">
      <div className="flex items-center gap-2">
        <SableMark className="size-4" />
        <span className="flex-1 text-sm font-medium">Sable summary</span>
        <Button type="button" variant="outline" size="sm" onClick={generate} disabled={pending}>
          {pending ? <Loader2 className="size-3.5 animate-spin" /> : null}
          {text ? "Regenerate" : "Summarize for the board"}
        </Button>
      </div>
      {text ? (
        <>
          <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed">{text}</p>
          <p className="mt-1.5 text-xs text-muted-foreground">AI-generated from the facts above. Not saved, and it does not vote.</p>
        </>
      ) : (
        <p className="mt-1.5 text-xs text-muted-foreground">An AI-written recommendation from the facts above. It is not saved and does not vote.</p>
      )}
    </div>
  );
}
