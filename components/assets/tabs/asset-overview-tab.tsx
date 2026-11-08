import Link from "next/link";
import type { Asset } from "@prisma/client";
import { StatusBadge } from "@/components/status-badge";
import { ASSET_TYPE_META, ASSET_STATUS_META } from "@/lib/constants";
import { getFormatter, getT } from "@/lib/i18n/server";
import type { Translator } from "@/lib/i18n/translate";
import type { Formatter } from "@/lib/i18n/format";

type SpecRow = { label: string; value: React.ReactNode };

function buildSpecs(
  asset: Asset & { locationRef: { id: string; name: string } | null },
  t: Translator<"assets">,
  f: Formatter,
): SpecRow[] {
  const specs: SpecRow[] = [];
  const push = (label: string, value: React.ReactNode) => {
    if (value !== null && value !== undefined && value !== "")
      specs.push({ label, value });
  };
  push(t("spec.type"), <StatusBadge map={ASSET_TYPE_META} value={asset.type} dot />);
  push(t("spec.status"), <StatusBadge map={ASSET_STATUS_META} value={asset.status} />);
  push(t("field.serial"), asset.serial ? <span className="font-mono">{asset.serial}</span> : null);
  push(t("field.model"), asset.model);
  push(t("field.manufacturer"), asset.manufacturer);
  push(t("spec.os"), asset.os);
  push(t("field.cpu"), asset.cpu);
  push(t("spec.ram"), asset.ramGb != null ? `${f.number(asset.ramGb)} GB` : null);
  push(t("spec.storage"), asset.storageGb != null ? `${f.number(asset.storageGb)} GB` : null);
  push(t("spec.ip"), asset.ipAddress ? <span className="font-mono">{asset.ipAddress}</span> : null);
  push(t("spec.mac"), asset.macAddress ? <span className="font-mono">{asset.macAddress}</span> : null);
  push(
    t("spec.location"),
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
  push(t("field.cost"), asset.cost != null ? f.number(asset.cost) : null);
  push(t("field.warrantyEnd"), asset.warrantyEnd ? f.date(asset.warrantyEnd) : null);
  return specs;
}

export async function AssetOverviewTab({
  asset,
}: {
  asset: Asset & { locationRef: { id: string; name: string } | null };
}) {
  const [t, f] = await Promise.all([getT("assets"), getFormatter()]);
  const specs = buildSpecs(asset, t, f);

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
