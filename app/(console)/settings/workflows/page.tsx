import type { Metadata } from "next";
import { Workflow } from "lucide-react";
import { requireRole } from "@/lib/session";
import { PageHeader, PageBody } from "@/components/page-header";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { WorkflowList } from "@/components/settings/workflow-list";
import { WorkflowGraph } from "@/components/settings/workflow-graph";
import { getEnumT, getT } from "@/lib/i18n/server";
import {
  WORKFLOW_ENTITY_TYPES, getEffectiveTransitions, type WorkflowEntityType,
} from "@/lib/workflow";
import {
  TICKET_STATUSES, PROBLEM_STATUSES, CHANGE_STATUSES,
  TICKET_STATUS_META, PROBLEM_STATUS_META, CHANGE_STATUS_META, type Meta, type Tone,
} from "@/lib/constants";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT("settings");
  return { title: t("workflows.metaTitle") };
}
export const dynamic = "force-dynamic";

/** Strip meta to the serializable {label, tone} the client editor needs (no icons). */
function stripMeta(m: Record<string, Meta>): Record<string, { label: string; tone: Tone }> {
  const out: Record<string, { label: string; tone: Tone }> = {};
  for (const [k, v] of Object.entries(m)) out[k] = { label: v.label, tone: v.tone };
  return out;
}

const SOURCE_META: Record<WorkflowEntityType, Record<string, Meta>> = {
  TICKET: TICKET_STATUS_META,
  PROBLEM: PROBLEM_STATUS_META,
  CHANGE: CHANGE_STATUS_META,
};

const META: Record<WorkflowEntityType, Record<string, { label: string; tone: Tone }>> = {
  TICKET: stripMeta(TICKET_STATUS_META),
  PROBLEM: stripMeta(PROBLEM_STATUS_META),
  CHANGE: stripMeta(CHANGE_STATUS_META),
};

const STATUS_ORDER: Record<WorkflowEntityType, readonly string[]> = {
  TICKET: TICKET_STATUSES,
  PROBLEM: PROBLEM_STATUSES,
  CHANGE: CHANGE_STATUSES,
};

function statusList(entityType: WorkflowEntityType, te: Awaited<ReturnType<typeof getEnumT>>) {
  const meta = META[entityType];
  return STATUS_ORDER[entityType].map((value) => ({
    value,
    label: meta[value] ? te(SOURCE_META[entityType], value) : value,
    tone: meta[value]?.tone ?? ("neutral" as Tone),
  }));
}

export default async function WorkflowsSettingsPage() {
  await requireRole("MANAGER");
  const [t, te] = await Promise.all([getT("settings"), getEnumT()]);

  const data = await Promise.all(
    WORKFLOW_ENTITY_TYPES.map(async (entityType) => ({
      entityType,
      statuses: statusList(entityType, te),
      transitions: await getEffectiveTransitions(entityType),
    })),
  );

  return (
    <>
      <PageHeader
        icon={Workflow}
        title={t("workflows.title")}
        description={t("workflows.description")}
      />
      <PageBody className="grid gap-6">
        {data.map(({ entityType, statuses, transitions }) => (
          <Card key={entityType}>
            <CardHeader>
              <CardTitle className="text-sm">{t(`workflows.entity.${entityType}`)}</CardTitle>
              <CardAction>
                <WorkflowGraph
                  entityType={entityType}
                  entityLabel={t(`workflows.entity.${entityType}`)}
                  statuses={statuses}
                  transitions={transitions}
                />
              </CardAction>
            </CardHeader>
            <CardContent>
              <WorkflowList
                // Remount when persisted transitions change (after save/reset) so
                // the editor reseeds from server state instead of stale local state.
                key={JSON.stringify(transitions)}
                entityType={entityType}
                statuses={statuses}
                transitions={transitions}
              />
            </CardContent>
          </Card>
        ))}
      </PageBody>
    </>
  );
}
