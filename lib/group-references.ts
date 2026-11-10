import { db } from "@/lib/db";
import { OPEN_TICKET_STATUSES } from "@/lib/constants";
import {
  FINISHED_ASSET_STATUSES, FINISHED_CHANGE_STATUSES, FINISHED_PROBLEM_STATUSES, FINISHED_RELEASE_STATUSES,
  nonEmptyReferences,
} from "@/lib/group-rules";

/**
 * What still points at a group (see lib/group-rules.ts for why). Counted per kind; kinds with nothing
 * are left out. The group id is a random cuid, so a substring match in the JSON columns (catalog
 * approval stages, automation rules) cannot hit anything else.
 */
export async function groupReferences(id: string) {
  const [
    categories, services, catalogItems, approvalStages, visibility, tickets, problems, changes, assets, releases,
    changeTemplates, recurringTickets, onCall, freezeWindows, automations,
  ] = await Promise.all([
    db.category.count({ where: { groupId: id } }),
    db.service.count({ where: { groupId: id } }),
    db.catalogItem.count({ where: { groupId: id } }),
    db.catalogItem.count({ where: { approvalStages: { contains: id } } }),
    db.catalogItemGroup.count({ where: { groupId: id } }),
    db.ticket.count({ where: { groupId: id, status: { in: [...OPEN_TICKET_STATUSES] } } }),
    db.problem.count({ where: { groupId: id, status: { notIn: [...FINISHED_PROBLEM_STATUSES] } } }),
    db.change.count({ where: { groupId: id, status: { notIn: [...FINISHED_CHANGE_STATUSES] } } }),
    db.asset.count({ where: { groupId: id, status: { notIn: [...FINISHED_ASSET_STATUSES] } } }),
    db.release.count({ where: { groupId: id, status: { notIn: [...FINISHED_RELEASE_STATUSES] } } }),
    db.changeTemplate.count({ where: { groupId: id } }),
    db.recurringTicket.count({ where: { groupId: id } }),
    db.onCallSchedule.count({ where: { groupId: id } }),
    db.changeFreezeWindow.count({ where: { groupId: id } }),
    db.automationRule.count({ where: { OR: [{ conditions: { contains: id } }, { actions: { contains: id } }] } }),
  ]);
  return nonEmptyReferences({
    categories, services, catalog_items: catalogItems, catalog_approval_stages: approvalStages, catalog_visibility: visibility,
    open_tickets: tickets, open_problems: problems, open_changes: changes, active_assets: assets, open_releases: releases,
    change_templates: changeTemplates, recurring_tickets: recurringTickets, on_call_schedules: onCall,
    freeze_windows: freezeWindows, automation_rules: automations,
  });
}
