import { EntityHistory } from "@/components/history/entity-history";
import type { ChangeTabContext } from "@/components/changes/tabs/types";

export function HistoryTab({ change }: ChangeTabContext) {
  return <EntityHistory entity="Change" entityId={String(change.id)} />;
}
