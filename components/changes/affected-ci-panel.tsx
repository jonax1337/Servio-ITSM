import Link from "next/link";
import { Server, Network, Boxes, ShieldAlert } from "lucide-react";
import { StatusBadge } from "@/components/status-badge";
import { LinkPicker } from "@/components/link-picker";
import { ConfirmButton } from "@/components/confirm-dialog";
import { attachAffectedCi, detachAffectedCi } from "@/lib/actions/change-assets";
import { ASSET_TYPE_META, ASSET_RELATION_META, type Meta } from "@/lib/constants";
import type { OptionSearch } from "@/components/use-searched-options";
import { getEnumT, getT } from "@/lib/i18n/server";

export type AffectedCi = {
  assetId: string;
  name: string;
  type: string;
  status: string;
};

/** One downstream/upstream CI reached from an affected root, plus how it was reached. */
export type ImpactedCi = {
  id: string;
  name: string;
  assetType?: string;
  status?: string;
  relation?: string;
};

export type ChangeImpact = {
  /** Distinct CIs reachable from the affected roots (excluding the roots). */
  impacted: ImpactedCi[];
  /** Coarse risk label derived from the blast radius. */
  risk: "LOW" | "MEDIUM" | "HIGH";
};

const IMPACT_RISK_TONES: Record<ChangeImpact["risk"], Meta["tone"]> = { LOW: "success", MEDIUM: "warning", HIGH: "danger" };

export async function AffectedCiPanel({
  changeId,
  affected,
  impact,
  searchAssets,
  editable,
}: {
  changeId: number;
  affected: AffectedCi[];
  impact: ChangeImpact;
  /** Looks up the assets that can still be marked as affected, by the typed text. */
  searchAssets: OptionSearch;
  editable: boolean;
}) {
  const [t, tc, te] = await Promise.all([getT("changes"), getT("common"), getEnumT()]);
  const impactRiskMeta: Record<string, Meta> = Object.fromEntries(
    (["LOW", "MEDIUM", "HIGH"] as const).map((r) => [r, { label: t(`impact.blastRadius.${r}`), tone: IMPACT_RISK_TONES[r] }]),
  );
  return (
    <div className="mt-8">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <Server className="size-4 text-muted-foreground" />
          {t("impact.title", { count: affected.length })}
        </h2>
        {editable ? (
          <LinkPicker
            action={attachAffectedCi}
            triggerLabel={t("impact.addCi")}
            title={t("impact.addTitle")}
            description={t("impact.addDescription")}
            hidden={{ changeId }}
            valueName="assetId"
            search={searchAssets}
            placeholder={t("impact.chooseCi")}
            searchPlaceholder={t("form.searchCis")}
            emptyText={t("impact.noAssets")}
            submitLabel={t("impact.addCi")}
          />
        ) : null}
      </div>

      {affected.length === 0 ? (
        <div className="flex items-center gap-2 rounded-xl border border-dashed bg-card/50 px-4 py-6 text-sm text-muted-foreground">
          <Boxes className="size-4" />
          {editable ? t("impact.emptyEditable") : t("impact.empty")}
        </div>
      ) : (
        <>
          {/* Automated impact assessment (CMDB blast radius) */}
          <div className="mb-4 rounded-xl border bg-card p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Network className="size-4 text-primary" />
                {t("impact.assessment")}
              </div>
              <StatusBadge map={impactRiskMeta} value={impact.risk} />
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              {impact.impacted.length === 0 ? (
                <>{t("impact.noDownstream")}</>
              ) : (
                t.rich("impact.downstream", {
                  count: impact.impacted.length,
                  b: (chunks) => <span className="font-medium text-foreground">{chunks}</span>,
                })
              )}
            </p>
            {impact.impacted.length > 0 ? (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {impact.impacted.map((ci) => (
                  <Link
                    key={ci.id}
                    href={`/assets/${ci.id}`}
                    className="inline-flex items-center gap-1.5 rounded-lg border bg-background px-2 py-1 text-xs hover:border-primary/40"
                    title={ci.relation ? t("impact.via", { relation: te(ASSET_RELATION_META, ci.relation) }) : undefined}
                  >
                    <ShieldAlert className="size-3.5 text-amber-500" />
                    {ci.name}
                    {ci.relation ? (
                      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                        {te(ASSET_RELATION_META, ci.relation)}
                      </span>
                    ) : null}
                  </Link>
                ))}
              </div>
            ) : null}
          </div>

          {/* The directly affected CIs */}
          <div className="overflow-hidden rounded-xl border bg-card">
            {affected.map((ci) => (
              <div
                key={ci.assetId}
                className="flex items-center justify-between gap-3 border-b px-4 py-2.5 text-sm last:border-b-0 hover:bg-muted/40"
              >
                <Link href={`/assets/${ci.assetId}`} className="flex min-w-0 items-center gap-2 font-medium hover:underline">
                  <Server className="size-4 shrink-0 text-primary" />
                  <span className="truncate">{ci.name}</span>
                </Link>
                <div className="flex shrink-0 items-center gap-2">
                  <StatusBadge map={ASSET_TYPE_META} value={ci.type} dot />
                  {editable ? (
                    <ConfirmButton
                      action={detachAffectedCi}
                      fields={{ changeId, assetId: ci.assetId }}
                      title={t("impact.removeTitle")}
                      description={t("impact.removeDescription", { name: ci.name })}
                      confirmLabel={tc("remove")}
                      triggerVariant="ghost"
                      triggerSize="icon-sm"
                      triggerLabel={t("impact.removeCi")}
                    >
                      <span className="text-xs">{tc("remove")}</span>
                    </ConfirmButton>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
