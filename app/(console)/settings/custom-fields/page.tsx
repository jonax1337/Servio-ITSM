import type { Metadata } from "next";
import { SlidersHorizontal, Trash2, ChevronUp, ChevronDown, EyeOff } from "lucide-react";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/session";
import { PageHeader, PageBody } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { ToneBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { ConfirmButton } from "@/components/confirm-dialog";
import { Card, CardContent, CardTitle } from "@/components/ui/card";
import { CustomFieldEditor } from "@/components/custom-fields/custom-field-editor";
import { deleteCustomField, moveCustomField } from "@/lib/actions/custom-fields";
import {
  CUSTOM_FIELD_ENTITIES, CUSTOM_FIELD_ENTITY_LABELS, CUSTOM_FIELD_TYPE_LABELS,
  parseConditions, type CustomFieldDef, type CustomFieldEntity, type CustomFieldType,
} from "@/lib/custom-fields";
import { OPERATORS } from "@/lib/automation-defs";

export const metadata: Metadata = { title: "Custom Fields" };
export const dynamic = "force-dynamic";

const opLabel = (k: string) => OPERATORS.find((o) => o.value === k)?.label ?? k;

export default async function CustomFieldsPage() {
  await requireRole("MANAGER");
  const defs = await db.customFieldDef.findMany({
    orderBy: [{ entityType: "asc" }, { order: "asc" }],
  });

  return (
    <>
      <PageHeader
        icon={SlidersHorizontal}
        title="Custom Fields"
        description="Define extra fields on tickets, problems and changes — shown in the sidebar only when your conditions match."
      />

      <PageBody className="grid gap-8">
        {CUSTOM_FIELD_ENTITIES.map((entity) => {
          const rows = defs.filter((d) => d.entityType === entity) as CustomFieldDef[];
          return (
            <section key={entity} className="grid gap-3">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold">{CUSTOM_FIELD_ENTITY_LABELS[entity]}</h2>
                <CustomFieldEditor entityType={entity as CustomFieldEntity} />
              </div>

              {rows.length === 0 ? (
                <EmptyState icon={SlidersHorizontal} title={`No custom fields for ${CUSTOM_FIELD_ENTITY_LABELS[entity].toLowerCase()}`} description="Add a field to collect extra data on the detail sidebar.">
                  <CustomFieldEditor entityType={entity as CustomFieldEntity} />
                </EmptyState>
              ) : (
                <div className="grid gap-3">
                  {rows.map((d, i) => {
                    const conds = parseConditions(d.visibility);
                    return (
                      <Card key={d.id}>
                        <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <CardTitle className="text-sm">{d.label}</CardTitle>
                              <span className="font-mono text-xs text-muted-foreground">{d.key}</span>
                              <ToneBadge meta={{ label: CUSTOM_FIELD_TYPE_LABELS[d.type as CustomFieldType] ?? d.type, tone: "indigo" }} icon={false} />
                              {d.required ? <ToneBadge meta={{ label: "Required", tone: "warning" }} icon={false} /> : null}
                              {!d.active ? <ToneBadge meta={{ label: "Inactive", tone: "neutral" }} icon={false} /> : null}
                            </div>
                            {d.help ? <p className="mt-1 text-sm text-muted-foreground">{d.help}</p> : null}
                            <div className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
                              <EyeOff className="size-3.5" />
                              {conds.length === 0 ? (
                                <span>Always shown</span>
                              ) : (
                                <span>
                                  Shown when {conds.map((c, ci) => (
                                    <span key={ci}>
                                      {ci > 0 ? <span className="text-muted-foreground/70"> {d.matchType === "ANY" ? "or" : "and"} </span> : null}
                                      <span className="text-foreground">{c.field}</span> {opLabel(c.op)} {["empty", "not_empty"].includes(c.op) ? "" : <span className="text-foreground">{c.value}</span>}
                                    </span>
                                  ))}
                                </span>
                              )}
                            </div>
                          </div>

                          <div className="flex items-center gap-2">
                            <div className="flex flex-col">
                              <form action={moveCustomField}>
                                <input type="hidden" name="id" value={d.id} />
                                <input type="hidden" name="direction" value="up" />
                                <Button type="submit" variant="ghost" size="icon-sm" aria-label="Move up" disabled={i === 0} className="size-6">
                                  <ChevronUp className="size-4 text-muted-foreground" />
                                </Button>
                              </form>
                              <form action={moveCustomField}>
                                <input type="hidden" name="id" value={d.id} />
                                <input type="hidden" name="direction" value="down" />
                                <Button type="submit" variant="ghost" size="icon-sm" aria-label="Move down" disabled={i === rows.length - 1} className="size-6">
                                  <ChevronDown className="size-4 text-muted-foreground" />
                                </Button>
                              </form>
                            </div>
                            <CustomFieldEditor entityType={entity as CustomFieldEntity} def={d} />
                            <ConfirmButton
                              action={deleteCustomField}
                              fields={{ id: d.id }}
                              title="Delete custom field?"
                              description={`"${d.label}" and the values stored in it will be permanently deleted.`}
                              triggerVariant="ghost"
                              triggerLabel="Delete field"
                            >
                              <Trash2 className="size-4 text-muted-foreground" />
                            </ConfirmButton>
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              )}
            </section>
          );
        })}
      </PageBody>
    </>
  );
}
