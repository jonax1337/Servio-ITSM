"use client";

import { CustomFieldInput } from "@/components/custom-fields/custom-field-input";
import type { CustomFieldDef } from "@/lib/custom-fields";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useT } from "@/lib/i18n/client";

// Renders the "Custom fields" sidebar card for a detail page. The visible defs
// are already filtered server-side; if there are none we render nothing.
export function EntityCustomFields({
  entityType,
  entityId,
  defs,
  values,
  editable,
  className,
}: {
  entityType: string;
  entityId: number;
  defs: CustomFieldDef[];
  values: Record<string, string>;
  editable: boolean;
  className?: string;
}) {
  const t = useT("settings");
  if (defs.length === 0) return null;

  return (
    <Card className={className}>
      <CardHeader><CardTitle className="text-sm">{t("cfCard.title")}</CardTitle></CardHeader>
      <CardContent className="grid gap-3">
        {defs.map((def) => (
          <CustomFieldInput
            key={def.id}
            entityType={entityType}
            entityId={entityId}
            def={def}
            value={values[def.key] ?? ""}
            disabled={!editable}
          />
        ))}
      </CardContent>
    </Card>
  );
}
