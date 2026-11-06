import {
  DEFAULT_RENEWAL_NOTICE_DAYS, contractExpiry, daysUntil, type ContractTimeline, type LicenseCompliance,
} from "@/lib/contract-rules";
import { cn } from "@/lib/utils";
import type { Meta } from "@/lib/constants";
import { ToneBadge } from "@/components/status-badge";

function endsLabel(days: number): string {
  if (days === 0) return "Ends today";
  if (days === 1) return "Ends tomorrow";
  return `Ends in ${days} days`;
}

/** Warns about a contract that is inside its renewal notice period or already past its end date. */
export function ContractExpiryBadge({ contract, now }: { contract: ContractTimeline; now: Date }) {
  const expiry = contractExpiry(contract, now);
  if (expiry !== "EXPIRING" && expiry !== "EXPIRED") return null;
  const meta: Meta =
    expiry === "EXPIRED"
      ? { label: "Expired", tone: "danger" }
      : { label: endsLabel(daysUntil(contract.endDate as Date, now)), tone: "warning" };
  return <ToneBadge meta={meta} dot />;
}

/** The same warning for a license, which only has an expiry date. */
export function LicenseExpiryBadge({ expiresAt, now }: { expiresAt: Date | null; now: Date }) {
  return (
    <ContractExpiryBadge
      contract={{ status: "ACTIVE", endDate: expiresAt, renewalNoticeDays: DEFAULT_RENEWAL_NOTICE_DAYS }}
      now={now}
    />
  );
}

/** Seats used against seats purchased, toned by compliance. */
export function LicenseComplianceBadge({ compliance }: { compliance: LicenseCompliance }) {
  const base = `${compliance.used} / ${compliance.seats} seats`;
  const meta: Meta =
    compliance.state === "OVER"
      ? { label: `${base} · ${compliance.overBy} over`, tone: "danger" }
      : { label: base, tone: compliance.state === "FULL" ? "warning" : "success" };
  return <ToneBadge meta={meta} dot />;
}

const METER_FILL: Record<LicenseCompliance["state"], string> = {
  OK: "bg-emerald-500",
  FULL: "bg-amber-500",
  OVER: "bg-destructive",
};

/** A bar of assigned seats against purchased seats; an over-allocation fills it completely in red. */
export function SeatMeter({ compliance }: { compliance: LicenseCompliance }) {
  const percent = compliance.seats > 0 ? Math.min(100, Math.round((compliance.used / compliance.seats) * 100)) : 0;
  return (
    <div
      role="meter"
      aria-label="Seats assigned"
      aria-valuemin={0}
      aria-valuemax={compliance.seats}
      aria-valuenow={compliance.used}
      className="h-2 overflow-hidden rounded-full bg-muted"
    >
      <div className={cn("h-full rounded-full transition-[width]", METER_FILL[compliance.state])} style={{ width: `${percent}%` }} />
    </div>
  );
}
