"use client";

import Link from "next/link";
import { X } from "lucide-react";
import { toast } from "sonner";
import type { ReactNode } from "react";
import { readActionResult } from "@/lib/action-result";

/**
 * A linked-record chip: a bordered pill linking to the record, with an unlink
 * control revealed on hover. Shared by ticket/problem/change/asset linking and
 * Sable project links so the look (and behaviour) is identical everywhere.
 */
export function LinkedChip({
  href,
  icon,
  label,
  unlink,
}: {
  href: string;
  icon: ReactNode;
  label: string;
  unlink?: ReactNode;
}) {
  return (
    <span className="group/chip inline-flex items-center rounded-lg border text-xs transition-colors hover:border-primary/40">
      <Link href={href} className="inline-flex items-center gap-1.5 py-1 pr-1.5 pl-2.5">
        {icon} {label}
      </Link>
      {unlink}
    </span>
  );
}

/** The unlink submit for a {@link LinkedChip}: a tiny form posting hidden fields to `action`. */
export function UnlinkButton({
  action,
  fields,
  successMessage = "Unlinked",
}: {
  // Actions may return void or a typed result ({ ok, error }) — failures are
  // surfaced as a toast instead of silently no-oping.
  action: (formData: FormData) => void | Promise<unknown>;
  fields: Record<string, string | number>;
  successMessage?: string;
}) {
  // Adapt to <form action>'s `Promise<void>` signature while tolerating actions
  // that return nothing at all.
  const submit = async (fd: FormData): Promise<void> => {
    const result = readActionResult(await action(fd));
    if (!result) return;
    if (result.ok) toast.success(successMessage);
    else toast.error(result.error || "Could not unlink record.");
  };
  return (
    <form action={submit} className="flex">
      {Object.entries(fields).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <button
        type="submit"
        aria-label="Unlink"
        className="mr-1 grid size-5 place-items-center rounded text-muted-foreground opacity-0 transition-opacity group-hover/chip:opacity-100 hover:text-destructive"
      >
        <X className="size-3.5" />
      </button>
    </form>
  );
}
