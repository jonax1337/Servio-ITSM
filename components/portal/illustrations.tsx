/**
 * Portal spot illustrations — soft, rounded, on-brand line art.
 *
 * All colours reference the theme CSS variables so the art tracks light/dark
 * and any accent retheme automatically. Keep the style consistent: rounded
 * shapes, 2px strokes with round caps, the Relay lead colour, muted
 * neutrals, and sparse accent sparkles. Sized via className (default provided).
 */

type Props = { className?: string };

/** Decorative sparkle plus-signs, shared across scenes. */
function Sparkle({ x, y, s = 6 }: { x: number; y: number; s?: number }) {
  return (
    <path
      d={`M${x} ${y - s} L${x} ${y + s} M${x - s} ${y} L${x + s} ${y}`}
      stroke="var(--primary)"
      strokeWidth="2.2"
      strokeLinecap="round"
      opacity="0.55"
    />
  );
}

/** Friendly "how can we help" chat scene — for the home hero. */
export function HeroChatArt({ className = "h-20 w-20" }: Props) {
  return (
    <svg viewBox="0 0 96 96" fill="none" className={className} aria-hidden="true">
      <ellipse cx="48" cy="80" rx="34" ry="6" fill="var(--primary)" opacity="0.10" />
      {/* back bubble */}
      <rect x="18" y="20" width="46" height="34" rx="12" fill="var(--primary)" opacity="0.16" />
      {/* front bubble */}
      <path
        d="M30 30h36a10 10 0 0 1 10 10v12a10 10 0 0 1-10 10H46l-10 8v-8h-6a10 10 0 0 1-10-10V40a10 10 0 0 1 10-10Z"
        fill="var(--primary)"
      />
      {/* dots */}
      <circle cx="40" cy="46" r="3" fill="var(--primary-foreground)" />
      <circle cx="50" cy="46" r="3" fill="var(--primary-foreground)" />
      <circle cx="60" cy="46" r="3" fill="var(--primary-foreground)" />
      <Sparkle x={78} y={26} s={5} />
      <Sparkle x={20} y={62} s={4} />
    </svg>
  );
}

/** All caught up — for the empty "your open requests" / tickets states. */
export function AllCaughtUpArt({ className = "h-28 w-28" }: Props) {
  return (
    <svg viewBox="0 0 160 130" fill="none" className={className} aria-hidden="true">
      <ellipse cx="80" cy="112" rx="52" ry="9" fill="var(--primary)" opacity="0.10" />
      {/* paper */}
      <rect x="44" y="26" width="72" height="80" rx="12" fill="var(--card)" stroke="var(--border)" strokeWidth="2" />
      <path d="M58 50h44M58 64h44M58 78h28" stroke="var(--muted-foreground)" strokeWidth="3" strokeLinecap="round" opacity="0.4" />
      {/* check badge */}
      <circle cx="112" cy="90" r="18" fill="var(--chart-4)" />
      <path d="M104 90l6 6 11-12" stroke="#fff" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" />
      <Sparkle x={36} y={34} s={5} />
      <Sparkle x={128} y={40} s={4} />
      <Sparkle x={30} y={78} s={4} />
    </svg>
  );
}

/** No results / empty knowledge — magnifier over a card. */
export function NoResultsArt({ className = "h-28 w-28" }: Props) {
  return (
    <svg viewBox="0 0 160 130" fill="none" className={className} aria-hidden="true">
      <ellipse cx="80" cy="112" rx="52" ry="9" fill="var(--primary)" opacity="0.10" />
      <rect x="34" y="24" width="74" height="72" rx="12" fill="var(--card)" stroke="var(--border)" strokeWidth="2" />
      <path d="M48 44h46M48 58h46M48 72h30" stroke="var(--muted-foreground)" strokeWidth="3" strokeLinecap="round" opacity="0.35" />
      {/* magnifier */}
      <circle cx="104" cy="82" r="22" fill="var(--primary)" opacity="0.14" />
      <circle cx="104" cy="82" r="22" stroke="var(--primary)" strokeWidth="4" />
      <path d="M120 98l14 14" stroke="var(--primary)" strokeWidth="5" strokeLinecap="round" />
      <Sparkle x={30} y={30} s={5} />
      <Sparkle x={128} y={36} s={4} />
    </svg>
  );
}

/** Report an issue — a screen with a friendly alert. Warm accent = attention. */
export function ReportIssueArt({ className = "h-16 w-24" }: Props) {
  return (
    <svg viewBox="0 0 96 80" fill="none" className={className} aria-hidden="true">
      <ellipse cx="48" cy="70" rx="30" ry="5" fill="var(--primary)" opacity="0.10" />
      <rect x="20" y="14" width="56" height="44" rx="10" fill="var(--card)" stroke="var(--border)" strokeWidth="2" />
      <path d="M20 26h56" stroke="var(--border)" strokeWidth="2" />
      <circle cx="27" cy="20" r="1.6" fill="var(--muted-foreground)" opacity="0.5" />
      <circle cx="33" cy="20" r="1.6" fill="var(--muted-foreground)" opacity="0.5" />
      <circle cx="39" cy="20" r="1.6" fill="var(--muted-foreground)" opacity="0.5" />
      <path d="M48 32l13 22H35z" fill="var(--chart-5)" />
      <path d="M48 40v7" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" />
      <circle cx="48" cy="51" r="1.5" fill="#fff" />
      <Sparkle x={80} y={20} s={4} />
      <Sparkle x={16} y={46} s={4} />
    </svg>
  );
}

/** Request something — a gift/box with a plus. Fresh accent = something new. */
export function RequestServiceArt({ className = "h-16 w-24" }: Props) {
  return (
    <svg viewBox="0 0 96 80" fill="none" className={className} aria-hidden="true">
      <ellipse cx="48" cy="70" rx="30" ry="5" fill="var(--primary)" opacity="0.10" />
      <rect x="26" y="34" width="44" height="30" rx="8" fill="var(--primary)" opacity="0.16" />
      <rect x="22" y="26" width="52" height="14" rx="7" fill="var(--primary)" />
      <path d="M48 26v38" stroke="var(--primary-foreground)" strokeWidth="2" opacity="0.35" />
      <circle cx="72" cy="24" r="10" fill="var(--chart-4)" />
      <path d="M72 19v10M67 24h10" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" />
      <Sparkle x={18} y={30} s={4} />
      <Sparkle x={30} y={16} s={4} />
    </svg>
  );
}

/** Empty catalog — soft stacked boxes. */
export function EmptyCatalogArt({ className = "h-28 w-28" }: Props) {
  return (
    <svg viewBox="0 0 160 130" fill="none" className={className} aria-hidden="true">
      <ellipse cx="80" cy="112" rx="52" ry="9" fill="var(--primary)" opacity="0.10" />
      <rect x="40" y="60" width="80" height="44" rx="12" fill="var(--primary)" opacity="0.16" />
      <rect x="52" y="34" width="56" height="42" rx="12" fill="var(--card)" stroke="var(--border)" strokeWidth="2" />
      <path d="M52 50h56" stroke="var(--border)" strokeWidth="2" />
      <rect x="72" y="30" width="16" height="10" rx="4" fill="var(--primary)" />
      <Sparkle x={34} y={40} s={5} />
      <Sparkle x={128} y={48} s={4} />
    </svg>
  );
}
