import { db } from "@/lib/db";
import { nonEmptyReferences } from "@/lib/group-rules";

/**
 * What still points at a category (see lib/category-rules.ts for why). Counted per kind; kinds with
 * nothing are left out. The category id is a random cuid, so a substring match in the automation
 * rules' JSON cannot hit anything else.
 */
export async function categoryReferences(id: string) {
  const [subcategories, tickets, problems, changes, services, articles, catalogItems, changeTemplates, recurringTickets, automations] =
    await Promise.all([
      db.category.count({ where: { parentId: id } }),
      db.ticket.count({ where: { categoryId: id } }),
      db.problem.count({ where: { categoryId: id } }),
      db.change.count({ where: { categoryId: id } }),
      db.service.count({ where: { categoryId: id } }),
      db.article.count({ where: { categoryId: id } }),
      db.catalogItem.count({ where: { categoryId: id } }),
      db.changeTemplate.count({ where: { categoryId: id } }),
      db.recurringTicket.count({ where: { categoryId: id } }),
      db.automationRule.count({ where: { OR: [{ conditions: { contains: id } }, { actions: { contains: id } }] } }),
    ]);
  return nonEmptyReferences({
    subcategories, tickets, problems, changes, services, articles, catalog_items: catalogItems,
    change_templates: changeTemplates, recurring_tickets: recurringTickets, automation_rules: automations,
  });
}
