import Link from "next/link";
import { Server } from "lucide-react";
import { db } from "@/lib/db";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/status-badge";
import { LinkPicker } from "@/components/link-picker";
import { ConfirmButton } from "@/components/confirm-dialog";
import { attachProblemAsset, detachProblemAsset, searchProblemCis } from "@/lib/actions/problem-assets";
import { ASSET_TYPE_META } from "@/lib/constants";
import { getT } from "@/lib/i18n/server";

/**
 * The configuration items a problem is known to affect. Agents add and remove them; the services
 * they run are derived into the affected-services card below it (lib/service-graph.ts).
 */
export async function ProblemAffectedCis({ problemId, editable, className }: { problemId: number; editable: boolean; className?: string }) {
  const [links, t, tc] = await Promise.all([
    db.problemAsset.findMany({
      where: { problemId },
      select: { asset: { select: { id: true, name: true, type: true } } },
      orderBy: { asset: { name: "asc" } },
    }),
    getT("problems"),
    getT("common"),
  ]);

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-2 text-sm">
          <span className="flex items-center gap-2">
            <Server className="size-4 text-muted-foreground" />
            {t("affectedCis.heading", { count: links.length })}
          </span>
          {editable ? (
            <LinkPicker
              action={attachProblemAsset}
              triggerLabel={t("affectedCis.add")}
              title={t("affectedCis.addTitle")}
              description={t("affectedCis.addDescription")}
              hidden={{ problemId }}
              valueName="assetId"
              search={searchProblemCis.bind(null, problemId)}
              placeholder={t("affectedCis.choose")}
              searchPlaceholder={t("affectedCis.search")}
              emptyText={t("affectedCis.noAssets")}
              submitLabel={t("affectedCis.add")}
            />
          ) : null}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {links.length === 0 ? (
          <p className="text-sm text-muted-foreground">{editable ? t("affectedCis.emptyEditable") : t("affectedCis.empty")}</p>
        ) : (
          <ul className="grid gap-1.5">
            {links.map(({ asset }) => (
              <li key={asset.id} className="flex items-center justify-between gap-2 text-sm">
                <Link href={`/assets/${asset.id}`} className="flex min-w-0 items-center gap-2 font-medium hover:underline">
                  <span className="truncate">{asset.name}</span>
                </Link>
                <div className="flex shrink-0 items-center gap-1.5">
                  <StatusBadge map={ASSET_TYPE_META} value={asset.type} dot />
                  {editable ? (
                    <ConfirmButton
                      action={detachProblemAsset}
                      fields={{ problemId, assetId: asset.id }}
                      title={t("affectedCis.removeTitle")}
                      description={t("affectedCis.removeDescription", { name: asset.name })}
                      confirmLabel={tc("remove")}
                      triggerVariant="ghost"
                      triggerSize="icon-sm"
                      triggerLabel={t("affectedCis.remove")}
                    >
                      <span className="text-xs">{tc("remove")}</span>
                    </ConfirmButton>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
