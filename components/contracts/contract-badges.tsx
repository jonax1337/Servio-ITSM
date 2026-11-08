import {
  DEFAULT_RENEWAL_NOTICE_DAYS, contractExpiry, daysUntil, type ContractTimeline, type LicenseCompliance,
} from "@/lib/contract-rules";
import { cn } from "@/lib/utils";
import type { Meta } from "@/lib/constants";
import { ToneBadge } from "@/components/status-badge";
import { getT } from "@/lib/i18n/server";
import { endsLabel } from "./contract-format";

/** Warns about a contract that is inside its renewal notice period or already past its end date. */
export async function ContractExpiryBadge({ contract, now }: { contract: ContractTimeline; now: Date }) {
  const expiry = contractExpiry(contract, now);
  if (expiry !== "EXPIRING" && expiry !== "EXPIRED") return null;
  const t = await getT("contracts");
  const meta: Meta =
    expiry === "EXPIRED"
      ? { label: t("expiry.expired"), tone: "danger" }
      : { label: endsLabel(t, daysUntil(contract.endDate as Date, now)), tone: "warning" };
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
export async function LicenseComplianceBadge({ compliance }: { compliance: LicenseCompliance }) {
  const t = await getT("contracts");
  const base = t("seats.usedOf", { used: compliance.used, seats: compliance.seats });
  const meta: Meta =
    compliance.state === "OVER"
      ? { label: t("seats.usedOver", { base, over: compliance.overBy }), tone: "danger" }
      : { label: base, tone: compliance.state === "FULL" ? "warning" : "success" };
  return <ToneBadge meta={meta} dot />;
}

const METER_FILL: Record<LicenseCompliance["state"], string> = {
  OK: "bg-emerald-500",
  FULL: "bg-amber-500",
  OVER: "bg-destructive",
};

/** A bar of assigned seats against purchased seats; an over-allocation fills it completely in red. */
export async function SeatMeter({ compliance }: { compliance: LicenseCompliance }) {
  const t = await getT("contracts");
  const percent = compliance.seats > 0 ? Math.min(100, Math.round((compliance.used / compliance.seats) * 100)) : 0;
  return (
    <div
      role="meter"
      aria-label={t("seats.assigned")}
      aria-valuemin={0}
      aria-valuemax={compliance.seats}
      aria-valuenow={compliance.used}
      className="h-2 overflow-hidden rounded-full bg-muted"
    >
      <div className={cn("h-full rounded-full transition-[width]", METER_FILL[compliance.state])} style={{ width: `${percent}%` }} />
    </div>
  );
}
