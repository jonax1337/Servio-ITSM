import Link from "next/link";
import { Server, Network, Boxes, ShieldAlert } from "lucide-react";
import { StatusBadge } from "@/components/status-badge";
import { LinkPicker } from "@/components/link-picker";
import { ConfirmButton } from "@/components/confirm-dialog";
import { attachAffectedCi, detachAffectedCi } from "@/lib/actions/change-assets";
import { ASSET_TYPE_META, ASSET_RELATION_META, type Meta } from "@/lib/constants";
import type { OptionSearch } from "@/components/use-searched-options";

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

const IMPACT_RISK_META: Record<string, Meta> = {
  LOW: { label: "Low blast radius", tone: "success" },
  MEDIUM: { label: "Medium blast radius", tone: "warning" },
  HIGH: { label: "High blast radius", tone: "danger" },
};

export function AffectedCiPanel({
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
  return (
    <div className="mt-8">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <Server className="size-4 text-muted-foreground" />
          Affected CIs · {affected.length}
        </h2>
        {editable ? (
          <LinkPicker
            action={attachAffectedCi}
            triggerLabel="Add CI"
            title="Mark a configuration item as affected"
            description="Link an asset that this change touches. Its downstream dependencies feed the automated impact assessment below."
            hidden={{ changeId }}
            valueName="assetId"
            search={searchAssets}
            placeholder="Choose a CI"
            searchPlaceholder="Search by name, tag or serial…"
            emptyText="No matching unlinked assets."
            submitLabel="Add CI"
          />
        ) : null}
      </div>

      {affected.length === 0 ? (
        <div className="flex items-center gap-2 rounded-xl border border-dashed bg-card/50 px-4 py-6 text-sm text-muted-foreground">
          <Boxes className="size-4" />
          No affected CIs recorded.{editable ? " Add the assets this change touches to compute its blast radius." : ""}
        </div>
      ) : (
        <>
          {/* Automated impact assessment (CMDB blast radius) */}
          <div className="mb-4 rounded-xl border bg-card p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Network className="size-4 text-primary" />
                Automated impact assessment
              </div>
              <StatusBadge map={IMPACT_RISK_META} value={impact.risk} />
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              {impact.impacted.length === 0 ? (
                <>No downstream dependencies found for the affected CIs. This change is self-contained.</>
              ) : (
                <>
                  <span className="font-medium text-foreground">{impact.impacted.length}</span>{" "}
                  further configuration item{impact.impacted.length === 1 ? "" : "s"} may be impacted through the CMDB dependency graph.
                </>
              )}
            </p>
            {impact.impacted.length > 0 ? (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {impact.impacted.map((ci) => (
                  <Link
                    key={ci.id}
                    href={`/assets/${ci.id}`}
                    className="inline-flex items-center gap-1.5 rounded-lg border bg-background px-2 py-1 text-xs hover:border-primary/40"
                    title={ci.relation ? `via ${ASSET_RELATION_META[ci.relation]?.label ?? ci.relation}` : undefined}
                  >
                    <ShieldAlert className="size-3.5 text-amber-500" />
                    {ci.name}
                    {ci.relation ? (
                      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                        {ASSET_RELATION_META[ci.relation]?.label ?? ci.relation}
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
                      title="Remove affected CI?"
                      description={`"${ci.name}" will no longer be marked as affected by this change.`}
                      confirmLabel="Remove"
                      triggerVariant="ghost"
                      triggerSize="icon-sm"
                      triggerLabel="Remove CI"
                    >
                      <span className="text-xs">Remove</span>
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
