"use client";

import { type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { AI_ASSISTANT_NAME } from "@/lib/constants";
import { SableMark } from "@/components/sable-mark";
import { BrandName } from "@/components/brand";
import { useT } from "@/lib/i18n/client";

/**
 * Shared Sable window chrome, so the console min-card and the self-service
 * portal widget are pixel-identical (single source of truth — no duplicated
 * frame/header/launcher markup).
 */

/** A small "Beta" tag shown on the console (agent-backend) Sable surfaces. */
export function SableBetaBadge({ className }: { className?: string }) {
  const t = useT("assistant");
  return (
    <span
      className={cn(
        "rounded-full bg-sable px-1.5 py-0.5 text-[9px] font-semibold uppercase leading-none tracking-wide text-sable-foreground",
        className,
      )}
    >
      {t("beta")}
    </span>
  );
}

/** Panel frame + min-card size — referenced by both the console min state and the portal. */
export const SABLE_PANEL_FRAME =
  "flex flex-col overflow-hidden rounded-xl border bg-background shadow-2xl";
export const SABLE_MIN_SIZE =
  "h-[560px] max-h-[calc(100vh-2rem)] w-[min(400px,calc(100vw-2rem))]";

/** Enter / exit animations for the floating card. */
export const SABLE_ENTER = "duration-200 animate-in fade-in-0 zoom-in-95 slide-in-from-bottom-4";
export const SABLE_EXIT = "duration-150 animate-out fade-out-0 zoom-out-95 slide-out-to-bottom-4";

/** The floating launcher — an icon-only square (no label). Bottom-right. */
export function SableFab({
  onClick,
  ariaLabel,
  beta = false,
}: {
  onClick: () => void;
  ariaLabel?: string;
  beta?: boolean;
}) {
  const t = useT("assistant");
  return (
    <button
      type="button"
      aria-label={ariaLabel ?? t(beta ? "openSableBeta" : "openSable", { name: AI_ASSISTANT_NAME })}
      onClick={onClick}
      className={cn(
        "sable-glow fixed bottom-4 right-4 z-40 grid size-12 place-items-center rounded-xl",
        "bg-brand-navy text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ice focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        "duration-200 animate-in zoom-in-50 fade-in",
        "transition-[transform,box-shadow] hover:scale-105 active:scale-95",
      )}
    >
      <SableMark className="size-7" />
      {beta ? (
        <span className="bg-background text-sable border-border absolute -right-1.5 -top-1.5 rounded-full border px-1 py-px text-[8px] font-semibold uppercase leading-none tracking-wide shadow-sm">
          {t("beta")}
        </span>
      ) : null}
    </button>
  );
}

/**
 * The window header — Sable badge + wordmark + subtitle, an optional `extra`
 * slot (e.g. the console scope toggle / a portal preview badge), and the action
 * buttons passed as children (right-aligned).
 */
export function SableHeader({
  subtitle,
  extra,
  beta = false,
  children,
}: {
  subtitle?: ReactNode;
  extra?: ReactNode;
  beta?: boolean;
  children?: ReactNode;
}) {
  return (
    <header className="flex items-center gap-2.5 border-b px-3 py-2.5">
      <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-sable text-sable-foreground">
        <SableMark className="size-5" />
      </span>
      <div className="min-w-0">
        <div className="flex items-center gap-1.5">
          <BrandName brand="sable" className="h-4" />
          {beta ? <SableBetaBadge /> : null}
        </div>
        {subtitle ? <div className="truncate text-[11px] text-muted-foreground">{subtitle}</div> : null}
      </div>
      {extra}
      <div className="ml-auto flex items-center gap-0.5">{children}</div>
    </header>
  );
}
