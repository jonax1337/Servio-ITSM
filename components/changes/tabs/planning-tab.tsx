import { ClipboardList, RotateCcw } from "lucide-react";
import { ChangeTextCard } from "@/components/changes/change-editors";
import { ChangeWindowEditor } from "@/components/changes/change-window-editor";
import { ChangeConflicts } from "@/components/changes/change-conflicts";
import { ChangeCopilot } from "@/components/changes/change-copilot";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatPlannedWindow, isWindowEditable, requiresRescheduleReason, submitFieldAnchor } from "@/lib/change-rules";
import type { ChangeTabContext } from "@/components/changes/tabs/types";

export function PlanningTab({ change, canEdit }: ChangeTabContext) {
  return (
    <div className="grid gap-4">
      <div id={submitFieldAnchor("implementationPlan")} className="scroll-mt-20">
        <ChangeTextCard
          id={change.id}
          field="implementationPlan"
          label="Implementation plan"
          icon={<ClipboardList className="size-4 text-muted-foreground" />}
          value={change.implementationPlan}
          emptyText="Not documented yet."
          editable={canEdit}
        />
      </div>
      <div id={submitFieldAnchor("rollbackPlan")} className="scroll-mt-20">
        <ChangeTextCard
          id={change.id}
          field="rollbackPlan"
          label="Rollback plan"
          icon={<RotateCcw className="size-4 text-muted-foreground" />}
          value={change.rollbackPlan}
          emptyText="Not documented yet."
          editable={canEdit}
        />
      </div>
      <ChangeCopilot changeId={change.id} editable={canEdit} />

      <Card id={submitFieldAnchor("plannedWindow")} className="scroll-mt-20">
        <CardHeader><CardTitle className="text-sm">Planned window</CardTitle></CardHeader>
        <CardContent className="max-w-sm text-sm">
          {canEdit && isWindowEditable(change.status) ? (
            <ChangeWindowEditor
              changeId={change.id}
              plannedStart={change.plannedStart}
              plannedEnd={change.plannedEnd}
              requiresReason={requiresRescheduleReason(change.status)}
            />
          ) : (
            <p className="font-medium">{formatPlannedWindow({ start: change.plannedStart, end: change.plannedEnd })}</p>
          )}
        </CardContent>
      </Card>

      <ChangeConflicts changeId={change.id} variant="panel" />
    </div>
  );
}
