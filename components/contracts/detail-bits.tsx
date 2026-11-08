import { ArrowLeft, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { LinkButton } from "@/components/link-button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getT } from "@/lib/i18n/server";

/**
 * Two-column frame of a contracts detail page, the same as tickets, changes and
 * assets: the main column and the properties rail scroll independently.
 */
export function DetailShell({ aside, children }: { aside: ReactNode; children: ReactNode }) {
  return (
    <div data-viewport-pane className="grid gap-0 lg:h-full lg:grid-cols-[1fr_320px] lg:overflow-hidden">
      <div className="min-w-0 border-b lg:min-h-0 lg:overflow-y-auto lg:border-b-0 lg:border-r">{children}</div>
      <aside className="grid content-start gap-4 p-4 sm:p-6 lg:min-h-0 lg:overflow-y-auto">{aside}</aside>
    </div>
  );
}

/** Top bar of a detail page: back link and identifying chips on the left, actions and status badges on the right. */
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
      <div className="ml-auto flex flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}

/** Heading block under the top bar. */
export function DetailTitle({ title, subtitle }: { title: string; subtitle?: ReactNode }) {
  return (
    <>
      <h1 className="font-display text-2xl font-semibold tracking-tight">{title}</h1>
      {subtitle ? <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p> : null}
    </>
  );
}

/** A titled card of the properties rail. */
export function RailCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">{title}</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-2.5 text-sm">{children}</CardContent>
    </Card>
  );
}

/** One label / value line in a rail card. */
export function MetaRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className="min-w-0 text-right font-medium tabular-nums">{children}</span>
    </div>
  );
}

/** The free-text notes of a record. */
export async function NotesBlock({ notes }: { notes: string | null }) {
  const t = await getT("contracts");
  return (
    <div className="rounded-xl border bg-card p-4 text-sm leading-relaxed whitespace-pre-wrap">
      {notes || <span className="text-muted-foreground">{t("notesEmpty")}</span>}
    </div>
  );
}

/** A banner that asks for attention: amber by default, red for something that is already wrong. */
export function Notice({ tone = "warning", children }: { tone?: "warning" | "danger"; children: ReactNode }) {
  const danger = tone === "danger";
  return (
    <p
      role={danger ? "alert" : undefined}
      className={cn(
        "flex items-start gap-2 rounded-xl border px-4 py-3 text-sm",
        danger ? "border-destructive/30 bg-destructive/10" : "border-amber-500/30 bg-amber-500/10",
      )}
    >
      <TriangleAlert
        className={cn("mt-0.5 size-4 shrink-0", danger ? "text-destructive" : "text-amber-600 dark:text-amber-400")}
      />
      <span>{children}</span>
    </p>
  );
}
