"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Combobox, type ComboOption } from "@/components/combobox";
import type { OptionSearch } from "@/components/use-searched-options";
import { useT } from "@/lib/i18n/client";

/** Pick what fails — a service or a configuration item — for the impact analysis; the choice lives in the URL. */
export function ImpactTargetPicker({
  services,
  searchAssets,
  serviceId,
  assetId,
}: {
  services: ComboOption[];
  searchAssets: OptionSearch;
  serviceId: string | null;
  assetId: string | null;
}) {
  const t = useT("services");
  const router = useRouter();
  const [pending, start] = useTransition();
  const go = (param: "service" | "asset", value: string) =>
    start(() => router.push(value ? `/services/impact?${param}=${encodeURIComponent(value)}` : "/services/impact"));

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="grid gap-1.5">
        <span className="text-xs font-medium text-muted-foreground">{t("impactPage.pickService")}</span>
        <Combobox
          options={services}
          value={serviceId ?? ""}
          onChange={(v) => go("service", v)}
          pending={pending}
          placeholder={t("chooseService")}
          searchPlaceholder={t("searchServices")}
        />
      </div>
      <div className="grid gap-1.5">
        <span className="text-xs font-medium text-muted-foreground">{t("impactPage.pickAsset")}</span>
        <Combobox
          search={searchAssets}
          value={assetId ?? ""}
          onChange={(v) => go("asset", v)}
          pending={pending}
          placeholder={t("chooseAsset")}
          searchPlaceholder={t("searchAssets")}
        />
      </div>
    </div>
  );
}
