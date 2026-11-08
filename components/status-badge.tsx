import { Crown } from "lucide-react";
import { cn } from "@/lib/utils";
import { TONE_CLASSES, metaFor, type Meta, type Tone } from "@/lib/constants";
import { enumOrigin } from "@/lib/i18n/enums";
import { EnumMsg, Msg } from "@/lib/i18n/client";

/** A meta label in the viewer's language (registered maps), or the label as given. */
export function MetaLabel({ meta }: { meta: Meta }) {
  const origin = enumOrigin(meta);
  return origin ? <EnumMsg map={origin[0]} value={origin[1]} fallback={meta.label} /> : <>{meta.label}</>;
}

export function ToneBadge({
  meta,
  className,
  dot = false,
  icon = true,
}: {
  meta: Meta;
  className?: string;
  dot?: boolean;
  icon?: boolean;
}) {
  const Icon = meta.icon;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium",
        TONE_CLASSES[meta.tone],
        className,
      )}
    >
      {icon && Icon ? (
        <Icon className="size-3" strokeWidth={2.25} />
      ) : dot ? (
        <span className="size-1.5 rounded-full bg-current opacity-80" />
      ) : null}
      <MetaLabel meta={meta} />
    </span>
  );
}

/** Gold VIP badge for important requesters. */
export function VipBadge({
  className,
  label = true,
}: {
  className?: string;
  label?: boolean;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 whitespace-nowrap rounded-full border border-amber-400/40 bg-gradient-to-b from-amber-300/20 to-amber-500/10 px-1.5 py-0.5 text-xs font-semibold text-amber-600 dark:text-amber-300",
        className,
      )}
    >
      <Crown className="size-3" strokeWidth={2.5} />
      {label ? "VIP" : null}
      <span className="sr-only">
        <Msg ns="components" k="vipHint" />
      </span>
    </span>
  );
}

export function StatusBadge({
  map,
  value,
  dot = true,
  className,
}: {
  map: Record<string, Meta>;
  value: string | null | undefined;
  dot?: boolean;
  className?: string;
}) {
  return <ToneBadge meta={metaFor(map, value)} dot={dot} className={className} />;
}

/** Small priority indicator with signal bars. */
export function PriorityDot({ tone }: { tone: Tone }) {
  return (
    <span
      className={cn("inline-block size-2.5 rounded-full", TONE_CLASSES[tone])}
    />
  );
}
