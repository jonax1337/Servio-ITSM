"use client";

import { useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { SableMark } from "@/components/sable-mark";
import { summarizeChangeForCab } from "@/lib/actions/change-copilot";
import { AI_ASSISTANT_NAME } from "@/lib/constants";
import { useServerMessage, useT } from "@/lib/i18n/client";

/** The optional AI paragraph of the CAB brief, generated on request. */
export function CabBriefProse({ changeId, teaser }: { changeId: number; teaser: boolean }) {
  const [text, setText] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const t = useT("changes");
  const tm = useServerMessage();

  function generate() {
    if (teaser) return void toast.info(t("aiTeaser"));
    startTransition(async () => {
      const result = await summarizeChangeForCab(changeId);
      if (result.ok) setText(result.text);
      else toast.error(tm(result.error));
    });
  }

  return (
    <div className="mt-4 rounded-lg border border-sable/25 bg-sable-muted/40 p-3">
      <div className="flex items-center gap-2">
        <SableMark className="size-4" />
        <span className="flex-1 text-sm font-medium">{t("brief.sableSummary", { name: AI_ASSISTANT_NAME })}</span>
        <Button type="button" variant="outline" size="sm" onClick={generate} disabled={pending}>
          {pending ? <Loader2 className="size-3.5 animate-spin" /> : null}
          {text ? t("brief.regenerate") : t("brief.summarize")}
        </Button>
      </div>
      {text ? (
        <>
          <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed">{text}</p>
          <p className="mt-1.5 text-xs text-muted-foreground">{t("brief.aiGenerated")}</p>
        </>
      ) : (
        <p className="mt-1.5 text-xs text-muted-foreground">{t("brief.aiHint")}</p>
      )}
    </div>
  );
}
