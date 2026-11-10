import { ArrowLeft } from "lucide-react";
import type { ReactNode } from "react";
import { LinkButton } from "@/components/link-button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * The split-pane frame every record detail page shares: the main column (header,
 * tabs, related records) and the properties rail scroll independently.
 *
 * The rail carries only what someone needs at a glance while working the record:
 * its status, editable properties, ownership and key dates. Related records
 * (CIs, services, linked tickets, attachments, articles) live in the main
 * column's tabs, never in the rail.
 */
export function DetailShell({ aside, children }: { aside: ReactNode; children: ReactNode }) {
  return (
    <div
      data-viewport-pane
      className="grid grid-cols-[minmax(0,1fr)] gap-0 lg:h-full lg:grid-cols-[minmax(0,1fr)_360px] lg:overflow-hidden xl:grid-cols-[minmax(0,1fr)_400px]"
    >
      <div className="min-w-0 border-b lg:min-h-0 lg:overflow-y-auto lg:border-b-0 lg:border-r">{children}</div>
      {/* A block stack, not a grid: Cards clip their overflow, so in a height-capped grid the
          rows would shrink to fit and cut cards off instead of letting the rail scroll. */}
      <aside className="space-y-4 p-4 sm:p-6 lg:min-h-0 lg:overflow-y-auto">{aside}</aside>
    </div>
  );
}

/**
 * Top bar of a detail page: back link and identifying chips (reference, type) on
 * the left, then actions and the record's state badges on the right.
 */
export function DetailTopBar({
  backHref,
  backLabel,
  lead,
  children,
}: {
  backHref: string;
  backLabel: string;
  lead?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3 border-b px-4 py-3 sm:px-6">
      <LinkButton href={backHref} variant="ghost" size="icon-sm" aria-label={backLabel}>
        <ArrowLeft className="size-4" />
      </LinkButton>
      {lead}
      <div className="ml-auto flex flex-wrap items-center justify-end gap-2">{children}</div>
    </div>
  );
}

/** Heading block under the top bar. */
export function DetailTitle({ title, subtitle }: { title: ReactNode; subtitle?: ReactNode }) {
  return (
    <>
      <h1 className="font-display text-2xl font-semibold tracking-tight wrap-anywhere">{title}</h1>
      {subtitle ? <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p> : null}
    </>
  );
}

/** A titled card of the properties rail; `hint` is a short line under the title. */
export function RailCard({
  title,
  hint,
  className,
  children,
}: {
  title: ReactNode;
  hint?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="text-sm">{title}</CardTitle>
        {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      </CardHeader>
      <CardContent className="grid gap-2.5 text-sm">{children}</CardContent>
    </Card>
  );
}

/** One label / value line in a rail card. */
export function MetaRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className="min-w-0 text-right font-medium tabular-nums wrap-anywhere">{children}</span>
    </div>
  );
}
