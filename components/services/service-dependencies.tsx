"use client";

import Link from "next/link";
import { ArrowDownToLine, ArrowUpFromLine } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/status-badge";
import { LinkPicker } from "@/components/link-picker";
import { UnlinkButton } from "@/components/linked-records";
import { addServiceDependency, removeServiceDependency } from "@/lib/actions/services";
import { SERVICE_STATUS_META } from "@/lib/constants";
import type { ComboOption } from "@/components/combobox";
import { useT } from "@/lib/i18n/client";

export type ServiceLinkRow = { id: string; name: string; code: string | null; status: string; note: string | null };

function LinkedService({ s, children }: { s: ServiceLinkRow; children?: React.ReactNode }) {
  return (
    <div className="group/chip flex items-start gap-2">
      <div className="min-w-0 flex-1">
        <Link href={`/services/${s.id}`} className="flex min-w-0 items-center gap-2 text-sm font-medium hover:text-primary">
          {s.code ? <span className="shrink-0 font-mono text-xs text-muted-foreground">{s.code}</span> : null}
          <span className="truncate">{s.name}</span>
        </Link>
        {s.note ? <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{s.note}</p> : null}
      </div>
      <StatusBadge map={SERVICE_STATUS_META} value={s.status} />
      {children}
    </div>
  );
}

/**
 * The service's place in the service map: what it depends on (editable) and
 * which services depend on it (managed on those services).
 */
export function ServiceDependencies({
  serviceId,
  dependsOn,
  usedBy,
  options,
  canEdit,
}: {
  serviceId: string;
  dependsOn: ServiceLinkRow[];
  usedBy: ServiceLinkRow[];
  /** Services this one may still depend on (not itself, not already listed). */
  options: ComboOption[];
  canEdit: boolean;
}) {
  const t = useT("services");
  const tc = useT("common");
  return (
    <div className="mt-4 grid gap-4 md:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm">
            <ArrowDownToLine className="size-4 text-muted-foreground" />
            {t("dependsOn", { count: dependsOn.length })}
            {canEdit ? (
              <span className="ml-auto">
                <LinkPicker
                  action={addServiceDependency}
                  triggerLabel={t("addDependency")}
                  title={t("addDependencyTitle")}
                  description={t("addDependencyDescription")}
                  hidden={{ serviceId }}
                  valueName="toServiceId"
                  options={options}
                  placeholder={t("chooseService")}
                  searchPlaceholder={t("searchServices")}
                  emptyText={t("noMoreServices")}
                  noteName="note"
                  notePlaceholder={t("dependencyNotePlaceholder")}
                  submitLabel={tc("add")}
                  successMessage={t("dependencyAdded")}
                />
              </span>
            ) : null}
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-2.5">
          {dependsOn.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("noDependencies")}</p>
          ) : (
            dependsOn.map((s) => (
              <LinkedService key={s.id} s={s}>
                {canEdit ? (
                  <UnlinkButton
                    action={removeServiceDependency}
                    fields={{ serviceId, toServiceId: s.id }}
                    successMessage={t("dependencyRemoved")}
                  />
                ) : null}
              </LinkedService>
            ))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm">
            <ArrowUpFromLine className="size-4 text-muted-foreground" />
            {t("usedBy", { count: usedBy.length })}
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-2.5">
          {usedBy.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("noDependents")}</p>
          ) : (
            usedBy.map((s) => <LinkedService key={s.id} s={s} />)
          )}
        </CardContent>
      </Card>
    </div>
  );
}
