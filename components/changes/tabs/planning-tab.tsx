import { ClipboardList, RotateCcw } from "lucide-react";
import { ChangeTextCard } from "@/components/changes/change-editors";
import { ChangeWindowEditor } from "@/components/changes/change-window-editor";
import { ChangeConflicts } from "@/components/changes/change-conflicts";
import { ChangeCopilot } from "@/components/changes/change-copilot";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { isWindowEditable, requiresRescheduleReason, submitFieldAnchor } from "@/lib/change-rules";
import type { ChangeTabContext } from "@/components/changes/tabs/types";
import { getFormatter, getT } from "@/lib/i18n/server";
import { formatWindow } from "@/components/changes/window-text";

export async function PlanningTab({ change, canEdit }: ChangeTabContext) {
  const [t, f] = await Promise.all([getT("changes"), getFormatter()]);
  return (
    <div className="grid gap-4">
      <div id={submitFieldAnchor("implementationPlan")} className="scroll-mt-20">
        <ChangeTextCard
          id={change.id}
          field="implementationPlan"
          label={t("planning.implementationPlan")}
          icon={<ClipboardList className="size-4 text-muted-foreground" />}
          value={change.implementationPlan}
          emptyText={t("notDocumented")}
          editable={canEdit}
        />
      </div>
      <div id={submitFieldAnchor("rollbackPlan")} className="scroll-mt-20">
        <ChangeTextCard
          id={change.id}
          field="rollbackPlan"
          label={t("planning.rollbackPlan")}
          icon={<RotateCcw className="size-4 text-muted-foreground" />}
          value={change.rollbackPlan}
          emptyText={t("notDocumented")}
          editable={canEdit}
        />
      </div>
      <ChangeCopilot changeId={change.id} editable={canEdit} />

      <Card id={submitFieldAnchor("plannedWindow")} className="scroll-mt-20">
        <CardHeader><CardTitle className="text-sm">{t("planning.plannedWindow")}</CardTitle></CardHeader>
        <CardContent className="max-w-sm text-sm">
          {canEdit && isWindowEditable(change.status) ? (
            <ChangeWindowEditor
              changeId={change.id}
              plannedStart={change.plannedStart}
              plannedEnd={change.plannedEnd}
              requiresReason={requiresRescheduleReason(change.status)}
            />
          ) : (
            <p className="font-medium">{formatWindow({ start: change.plannedStart, end: change.plannedEnd }, f, t)}</p>
          )}
        </CardContent>
      </Card>

      <ChangeConflicts changeId={change.id} variant="panel" />
    </div>
  );
}
