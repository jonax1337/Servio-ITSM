import Link from "next/link";
import { Network, HardDrive, X } from "lucide-react";
import { db } from "@/lib/db";
import { ToneBadge } from "@/components/status-badge";
import { LinkPicker } from "@/components/link-picker";
import { ConfirmButton } from "@/components/confirm-dialog";
import { ImpactGraph } from "@/components/assets/impact-graph";
import { addAssetRelation, deleteAssetRelation } from "@/lib/actions/assets";
import { computeImpact } from "@/lib/cmdb-graph";
import { ASSET_RELATION_META, ASSET_RELATION_TYPES, metaFor } from "@/lib/constants";
import { getEnumT, getT } from "@/lib/i18n/server";
import type { Translator } from "@/lib/i18n/translate";

export async function AssetRelationshipsTab({
  assetId,
  isAgentUser,
}: {
  assetId: string;
  isAgentUser: boolean;
}) {
  const [links, otherAssets, impact] = await Promise.all([
    db.asset.findUnique({
      where: { id: assetId },
      select: {
        relationsFrom: { include: { target: true } },
        relationsTo: { include: { source: true } },
      },
    }),
    isAgentUser
      ? db.asset.findMany({
          where: { id: { not: assetId } },
          select: { id: true, name: true, assetTag: true },
          orderBy: { name: "asc" },
          take: 300,
        })
      : [],
    computeImpact(assetId, { direction: "both" }),
  ]);
  const [t, te] = await Promise.all([getT("assets"), getEnumT()]);
  const relationTypeOpts = ASSET_RELATION_TYPES.map((ty) => ({
    value: ty,
    label: te(ASSET_RELATION_META[ty]),
    tone: ASSET_RELATION_META[ty].tone,
  }));
  const relationsFrom = links?.relationsFrom ?? [];
  const relationsTo = links?.relationsTo ?? [];
  const relationTargetOpts = otherAssets.map((a) => ({ value: a.id, label: a.assetTag ? `${a.name} · ${a.assetTag}` : a.name }));

  return (
    <>
      <div>
        <div className="mb-4 flex items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <Network className="size-4 text-muted-foreground" />
            {t("relations.heading", { count: relationsFrom.length + relationsTo.length })}
          </h2>
          {isAgentUser ? (
            <LinkPicker
              action={addAssetRelation}
              triggerLabel={t("relations.add")}
              title={t("relations.addTitle")}
              description={t("relations.addDescription")}
              hidden={{ sourceId: assetId }}
              valueName="targetId"
              options={relationTargetOpts}
              placeholder={t("relations.choose")}
              searchPlaceholder={t("relations.search")}
              emptyText={t("relations.noneAvailable")}
              submitLabel={t("relations.submit")}
              typeName="type"
              typeOptions={relationTypeOpts}
              typeDefault="DEPENDS_ON"
              successMessage={t("relations.added")}
            />
          ) : null}
        </div>
        {relationsFrom.length + relationsTo.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t("relations.empty")}
          </p>
        ) : (
          <div className="grid gap-2">
            {relationsFrom.map((r) => (
              <div
                key={r.id}
                className="group flex items-center gap-2 rounded-lg border bg-card px-3 py-2 text-sm hover:border-primary/40"
              >
                <Link href={`/assets/${r.targetId}`} className="flex min-w-0 flex-1 items-center gap-2">
                  <HardDrive className="size-4 text-primary" />
                  <span className="text-muted-foreground">{t("relations.thisCap")}</span>
                  <ToneBadge meta={metaFor(ASSET_RELATION_META, r.type)} />
                  <span className="font-medium">{r.target.name}</span>
                </Link>
                {isAgentUser ? <RelationUnlink t={t} relationId={r.id} assetId={assetId} /> : null}
              </div>
            ))}
            {relationsTo.map((r) => (
              <div
                key={r.id}
                className="group flex items-center gap-2 rounded-lg border bg-card px-3 py-2 text-sm hover:border-primary/40"
              >
                <Link href={`/assets/${r.sourceId}`} className="flex min-w-0 flex-1 items-center gap-2">
                  <HardDrive className="size-4 text-primary" />
                  <span className="font-medium">{r.source.name}</span>
                  <ToneBadge meta={metaFor(ASSET_RELATION_META, r.type)} />
                  <span className="text-muted-foreground">{t("relations.this")}</span>
                </Link>
                {isAgentUser ? <RelationUnlink t={t} relationId={r.id} assetId={assetId} /> : null}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Impact / blast radius */}
      <ImpactGraph impact={impact} />
    </>
  );
}

function RelationUnlink({ t, relationId, assetId }: { t: Translator<"assets">; relationId: string; assetId: string }) {
  return (
    <ConfirmButton
      action={deleteAssetRelation}
      fields={{ relationId, assetId }}
      successMessage={t("relations.removed")}
      title={t("relations.removeTitle")}
      description={t("relations.removeDescription")}
      confirmLabel={t("relations.removeConfirm")}
      triggerVariant="ghost"
      triggerSize="icon-xs"
      triggerClassName="shrink-0 text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
      triggerLabel={t("relations.removeLabel")}
    >
      <X className="size-3.5" />
    </ConfirmButton>
  );
}
