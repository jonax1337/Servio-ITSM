"use client";

import Link from "next/link";
import { HardDrive } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/status-badge";
import { LinkPicker } from "@/components/link-picker";
import { UnlinkButton } from "@/components/linked-records";
import { linkServiceAsset, unlinkServiceAsset } from "@/lib/actions/services";
import { ASSET_STATUS_META } from "@/lib/constants";
import type { ComboOption } from "@/components/combobox";
import { useT } from "@/lib/i18n/client";

export type ServiceAssetRow = { id: string; name: string; status: string };

/** The configuration items that support a service, with a picker to add more. */
export function ServiceAssets({
  serviceId,
  assets,
  options,
  canEdit,
}: {
  serviceId: string;
  assets: ServiceAssetRow[];
  options: ComboOption[];
  canEdit: boolean;
}) {
  const t = useT("services");
  const tc = useT("common");
  return (
    <Card className="mt-8">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <HardDrive className="size-4 text-muted-foreground" />
          {t("supportingCis", { count: assets.length })}
          {canEdit ? (
            <span className="ml-auto">
              <LinkPicker
                action={linkServiceAsset}
                triggerLabel={t("addCi")}
                title={t("addCiTitle")}
                description={t("addCiDescription")}
                hidden={{ serviceId }}
                valueName="assetId"
                options={options}
                placeholder={t("chooseAsset")}
                searchPlaceholder={t("searchAssets")}
                emptyText={t("noMoreAssets")}
                submitLabel={tc("add")}
                successMessage={t("ciAdded")}
              />
            </span>
          ) : null}
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-2">
        {assets.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("noCis")}</p>
        ) : (
          assets.map((a) => (
            <div key={a.id} className="flex items-center gap-2">
              <Link href={`/assets/${a.id}`} className="min-w-0 flex-1 truncate text-sm font-medium hover:text-primary">
                {a.name}
              </Link>
              <StatusBadge map={ASSET_STATUS_META} value={a.status} />
              {canEdit ? (
                <UnlinkButton
                  action={unlinkServiceAsset}
                  fields={{ serviceId, assetId: a.id }}
                  successMessage={t("ciRemoved")}
                />
              ) : null}
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}
