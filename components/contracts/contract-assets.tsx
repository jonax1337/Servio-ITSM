"use client";

import Link from "next/link";
import { HardDrive } from "lucide-react";
import { linkContractAsset, unlinkContractAsset } from "@/lib/actions/contracts";
import { ASSET_STATUS_META } from "@/lib/constants";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/status-badge";
import { LinkPicker } from "@/components/link-picker";
import { UnlinkButton } from "@/components/linked-records";
import type { ComboOption } from "@/components/combobox";
import { useT } from "@/lib/i18n/client";

export type CoveredAsset = { id: string; name: string; status: string };

/** The assets a contract covers, with a picker to add more (managers only). */
export function ContractAssets({
  contractId,
  assets,
  options,
  canEdit,
}: {
  contractId: string;
  assets: CoveredAsset[];
  options: ComboOption[];
  canEdit: boolean;
}) {
  const t = useT("contracts");
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <HardDrive className="size-4 text-muted-foreground" />
          {t("assets.coveredCount", { count: assets.length })}
          {canEdit ? (
            <span className="ml-auto">
              <LinkPicker
                action={linkContractAsset}
                triggerLabel={t("assets.add")}
                title={t("assets.coverTitle")}
                description={t("assets.coverDescription")}
                hidden={{ contractId }}
                valueName="assetId"
                options={options}
                placeholder={t("assets.choose")}
                searchPlaceholder={t("assets.search")}
                emptyText={t("assets.noneAvailable")}
                submitLabel={t("addShort")}
                successMessage={t("assets.added")}
              />
            </span>
          ) : null}
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-2">
        {assets.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {canEdit ? t("assets.emptyEditable") : t("assets.empty")}
          </p>
        ) : (
          assets.map((a) => (
            <div key={a.id} className="group/chip flex items-center gap-2">
              <Link href={`/assets/${a.id}`} className="min-w-0 flex-1 truncate text-sm font-medium hover:text-primary">
                {a.name}
              </Link>
              <StatusBadge map={ASSET_STATUS_META} value={a.status} />
              {canEdit ? (
                <UnlinkButton
                  action={unlinkContractAsset}
                  fields={{ contractId, assetId: a.id }}
                  successMessage={t("assets.removed")}
                />
              ) : null}
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}
