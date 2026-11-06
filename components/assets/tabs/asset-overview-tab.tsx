import Link from "next/link";
import type { Asset } from "@prisma/client";
import { StatusBadge } from "@/components/status-badge";
import { ASSET_TYPE_META, ASSET_STATUS_META } from "@/lib/constants";
import { format } from "date-fns";

type SpecRow = { label: string; value: React.ReactNode };

function buildSpecs(asset: Asset & { locationRef: { id: string; name: string } | null }): SpecRow[] {
  const specs: SpecRow[] = [];
  const push = (label: string, value: React.ReactNode) => {
    if (value !== null && value !== undefined && value !== "")
      specs.push({ label, value });
  };
  push("Type", <StatusBadge map={ASSET_TYPE_META} value={asset.type} dot />);
  push("Status", <StatusBadge map={ASSET_STATUS_META} value={asset.status} />);
  push("Serial", asset.serial ? <span className="font-mono">{asset.serial}</span> : null);
  push("Model", asset.model);
  push("Manufacturer", asset.manufacturer);
  push("OS", asset.os);
  push("CPU", asset.cpu);
  push("RAM", asset.ramGb != null ? `${asset.ramGb} GB` : null);
  push("Storage", asset.storageGb != null ? `${asset.storageGb} GB` : null);
  push("IP", asset.ipAddress ? <span className="font-mono">{asset.ipAddress}</span> : null);
  push("MAC", asset.macAddress ? <span className="font-mono">{asset.macAddress}</span> : null);
  push(
    "Location",
    asset.locationRef ? (
      <Link href={`/locations/${asset.locationRef.id}`} className="text-primary hover:underline">
        {asset.locationRef.name}
      </Link>
    ) : (
      asset.location
    ),
  );
  // Locale-formatted, currency-neutral — there's no org currency setting, so a
  // hard-coded symbol would be wrong outside the US.
  push("Cost", asset.cost != null ? asset.cost.toLocaleString() : null);
  push("Warranty end", asset.warrantyEnd ? format(asset.warrantyEnd, "PP") : null);
  return specs;
}

export function AssetOverviewTab({
  asset,
}: {
  asset: Asset & { locationRef: { id: string; name: string } | null };
}) {
  const specs = buildSpecs(asset);

  return (
    <>
      <div className="rounded-xl border bg-card p-4">
        <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
          {specs.map((s) => (
            <div
              key={s.label}
              className="flex items-center justify-between gap-2 text-sm"
            >
              <dt className="text-muted-foreground">{s.label}</dt>
              <dd className="text-right font-medium">{s.value}</dd>
            </div>
          ))}
        </dl>
      </div>

      {asset.notes ? (
        <div className="mt-4 rounded-xl border bg-card p-4 text-sm leading-relaxed whitespace-pre-wrap">
          {asset.notes}
        </div>
      ) : null}
    </>
  );
}
