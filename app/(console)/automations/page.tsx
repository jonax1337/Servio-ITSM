import type { Metadata } from "next";
import { Zap, Trash2, ChevronUp, ChevronDown } from "lucide-react";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/session";
import { getFormOptions } from "@/lib/data/options";
import { PageHeader, PageBody } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { ToneBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { ConfirmButton } from "@/components/confirm-dialog";
import { Card, CardContent } from "@/components/ui/card";
import { RuleBuilder, type AutomationOptions } from "@/components/automations/rule-builder";
import { ToggleRuleSwitch } from "@/components/automations/toggle-switch";
import { deleteRule, moveRule } from "@/lib/actions/automations";
import {
  parseJson, CONDITION_FIELDS, OPERATORS, ACTION_TYPES, TRIGGERS,
  type Condition, type AutomationAction,
} from "@/lib/automation-defs";
import {
  TICKET_STATUS_META, PRIORITY_META, TICKET_TYPE_META, LEVEL_META, SOURCE_META,
} from "@/lib/constants";
import { formatDistanceToNow } from "date-fns";

export const metadata: Metadata = { title: "Automations" };
export const dynamic = "force-dynamic";

export default async function AutomationsPage() {
  await requireRole("MANAGER");
  const [rules, opts] = await Promise.all([
    db.automationRule.findMany({ orderBy: { order: "asc" } }),
    getFormOptions(),
  ]);

  const options: AutomationOptions = {
    agents: opts.agents.map((a) => ({ value: a.id, label: a.name ?? a.email })),
    groups: opts.groups.map((g) => ({ value: g.id, label: g.name })),
    categories: opts.categories.map((c) => ({ value: c.id, label: c.name })),
    services: opts.services.map((s) => ({ value: s.id, label: s.name })),
  };

  // value → label lookup for readable summaries
  const valueLabel = new Map<string, string>();
  for (const list of Object.values(options)) for (const o of list) valueLabel.set(o.value, o.label);
  for (const m of [TICKET_STATUS_META, PRIORITY_META, TICKET_TYPE_META, LEVEL_META, SOURCE_META])
    for (const [k, v] of Object.entries(m)) valueLabel.set(k, v.label);
  const fieldLabel = (k: string) => CONDITION_FIELDS.find((f) => f.value === k)?.label ?? k;
  const opLabel = (k: string) => OPERATORS.find((o) => o.value === k)?.label ?? k;
  const actLabel = (k: string) => ACTION_TYPES.find((a) => a.value === k)?.label ?? k;
  const vLabel = (v?: string) => (v ? valueLabel.get(v) ?? v : "");

  return (
    <>
      <PageHeader
        icon={Zap}
        title="Automations"
        description="Rules that run when tickets are created or updated, top to bottom — reorder with the arrows. No code required."
      >
        <RuleBuilder options={options} />
      </PageHeader>

      <PageBody className="grid gap-4">
        {rules.length === 0 ? (
          <EmptyState icon={Zap} title="No automations yet" description="Create a rule to auto-assign, escalate, notify or tag tickets.">
            <RuleBuilder options={options} />
          </EmptyState>
        ) : (
          rules.map((r, i) => {
            const conditions = parseJson<Condition[]>(r.conditions, []);
            const actions = parseJson<AutomationAction[]>(r.actions, []);
            return (
              <Card key={r.id}>
                <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{r.name}</span>
                      <ToneBadge meta={{ label: TRIGGERS.find((t) => t.value === r.trigger)?.label ?? r.trigger, tone: "indigo" }} icon={false} />
                      {!r.isActive ? <ToneBadge meta={{ label: "Disabled", tone: "neutral" }} icon={false} /> : null}
                    </div>
                    {r.description ? <p className="mt-1 text-sm text-muted-foreground">{r.description}</p> : null}
                    <div className="mt-3 grid gap-1.5 text-sm">
                      <div className="text-muted-foreground">
                        <span className="font-medium text-foreground">If </span>
                        {conditions.length === 0 ? "always" : conditions.map((c, i) => (
                          <span key={i}>
                            {i > 0 ? <span className="text-muted-foreground/70"> {r.matchType === "ANY" ? "or" : "and"} </span> : null}
                            <span className="text-foreground">{fieldLabel(c.field)}</span> {opLabel(c.op)} {["empty", "not_empty"].includes(c.op) ? "" : <span className="text-foreground">{vLabel(c.value)}</span>}
                          </span>
                        ))}
                      </div>
                      <div className="text-muted-foreground">
                        <span className="font-medium text-foreground">Then </span>
                        {actions.map((a, i) => (
                          <span key={i}>
                            {i > 0 ? <span className="text-muted-foreground/70">, </span> : null}
                            <span className="text-foreground">{actLabel(a.type)}</span>{a.value ? <> → <span className="text-foreground">{vLabel(a.value)}</span></> : null}
                          </span>
                        ))}
                      </div>
                    </div>
                    <p className="mt-3 text-xs text-muted-foreground">
                      Ran {r.runCount}× {r.lastRunAt ? `· last ${formatDistanceToNow(r.lastRunAt, { addSuffix: true })}` : ""}
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    <div className="flex flex-col">
                      <form action={moveRule}>
                        <input type="hidden" name="id" value={r.id} />
                        <input type="hidden" name="direction" value="up" />
                        <Button type="submit" variant="ghost" size="icon-sm" aria-label="Move up" title="Run earlier" disabled={i === 0} className="size-6">
                          <ChevronUp className="size-4 text-muted-foreground" />
                        </Button>
                      </form>
                      <form action={moveRule}>
                        <input type="hidden" name="id" value={r.id} />
                        <input type="hidden" name="direction" value="down" />
                        <Button type="submit" variant="ghost" size="icon-sm" aria-label="Move down" title="Run later" disabled={i === rules.length - 1} className="size-6">
                          <ChevronDown className="size-4 text-muted-foreground" />
                        </Button>
                      </form>
                    </div>
                    <ToggleRuleSwitch id={r.id} active={r.isActive} />
                    <RuleBuilder
                      options={options}
                      rule={{ id: r.id, name: r.name, description: r.description, trigger: r.trigger, matchType: r.matchType, conditions, actions, isActive: r.isActive }}
                    />
                    <ConfirmButton
                      action={deleteRule}
                      fields={{ id: r.id }}
                      title="Delete rule?"
                      description={`"${r.name}" will be permanently deleted and stop running.`}
                      triggerVariant="ghost"
                      triggerLabel="Delete rule"
                    >
                      <Trash2 className="size-4 text-muted-foreground" />
                    </ConfirmButton>
                  </div>
                </CardContent>
              </Card>
            );
          })
        )}
      </PageBody>
    </>
  );
}
