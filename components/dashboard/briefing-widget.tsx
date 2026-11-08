"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { CalendarClock, CheckCheck, Clock, Loader2, MessageCircle, ShieldCheck, type LucideIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { SableMark } from "@/components/sable-mark";
import { cn } from "@/lib/utils";
import { summarizeBriefing } from "@/lib/dashboard/briefing-actions";
import { briefingIsEmpty } from "@/lib/dashboard/briefing-rules";
import type { BriefingSection, BriefingSectionKey } from "@/lib/dashboard/types";
import { useFormatter, useServerMessage, useT } from "@/lib/i18n/client";

const SECTION_ICONS: Record<BriefingSectionKey, LucideIcon> = {
  sla: Clock,
  customer: MessageCircle,
  approvals: ShieldCheck,
  changes: CalendarClock,
};

const TONE_TEXT = {
  danger: "text-red-600 dark:text-red-400",
  warning: "text-amber-600 dark:text-amber-400",
} as const;

/** A single column that may shrink below its content, so long labels truncate instead of widening the card. */
const SHRINKABLE_COLUMN = "grid grid-cols-[minmax(0,1fr)]";

function SectionBlock({ section }: { section: BriefingSection }) {
  const Icon = SECTION_ICONS[section.key];
  const t = useT("dashboard");
  const f = useFormatter();
  const hidden = section.total - section.items.length;
  return (
    <section className={cn(SHRINKABLE_COLUMN, "gap-1")}>
      <h4 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        <Icon className="size-3.5" />
        {section.title}
        <span className="tabular-nums">· {f.number(section.total)}</span>
      </h4>
      <ul className="-mx-2">
        {section.items.map((item) => (
          <li key={item.href + item.detail}>
            <Link href={item.href} className="flex items-baseline gap-2 rounded-md px-2 py-1 text-sm hover:bg-muted/50">
              <span className="min-w-0 flex-1 truncate font-medium">{item.label}</span>
              <span
                className={cn(
                  "shrink-0 text-xs text-muted-foreground",
                  item.tone === "danger" || item.tone === "warning" ? TONE_TEXT[item.tone] : undefined,
                )}
              >
                {item.detail}
              </span>
            </Link>
          </li>
        ))}
        {hidden > 0 ? <li className="px-2 py-0.5 text-xs text-muted-foreground">{t("andMore", { count: hidden })}</li> : null}
      </ul>
    </section>
  );
}

/** Body of the "briefing" widget: the viewer's attention list plus an on-demand Sable paragraph. */
export function BriefingBody({ sections, aiAvailable }: { sections: BriefingSection[]; aiAvailable: boolean }) {
  const [summary, setSummary] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const t = useT("dashboard");
  const tm = useServerMessage();

  function summarize() {
    startTransition(async () => {
      const result = await summarizeBriefing();
      if (result.ok) setSummary(tm(result.text));
      else toast.error(tm(result.error));
    });
  }

  if (briefingIsEmpty(sections)) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <CheckCheck className="size-4" /> {t("allClear")}
      </p>
    );
  }

  return (
    <div className={cn(SHRINKABLE_COLUMN, "gap-3")}>
      {aiAvailable ? (
        <div className="rounded-lg border border-sable/25 bg-sable-muted/40 p-2.5">
          <div className="flex items-center gap-2">
            <SableMark className="size-4" />
            <span className="flex-1 text-xs font-medium">{t("sableSummary")}</span>
            <Button type="button" variant="ghost" size="xs" onClick={summarize} disabled={pending}>
              {pending ? <Loader2 className="size-3 animate-spin" /> : null}
              {summary ? t("refresh") : t("summarize")}
            </Button>
          </div>
          {summary ? (
            <>
              <p className="mt-1.5 text-sm leading-relaxed">{summary}</p>
              <p className="mt-1 text-xs text-muted-foreground">{t("aiGenerated")}</p>
            </>
          ) : null}
        </div>
      ) : null}
      {sections
        .filter((section) => section.total > 0)
        .map((section) => (
          <SectionBlock key={section.key} section={section} />
        ))}
    </div>
  );
}
