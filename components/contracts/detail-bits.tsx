import { TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { getT } from "@/lib/i18n/server";

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
