/**
 * The rule for deleting a category through the API. Pure and DB-free, so the contract is
 * unit-testable; the counting queries live in lib/category-references.ts.
 *
 * A category is both routing configuration (catalog items, change templates, recurring tickets,
 * automations) and a reporting dimension of tickets, problems and changes. Deleting it would quietly
 * clear those links, so the API refuses while anything points at it, like the console and like
 * DELETE /groups/{id}, and says what. Unlike groups, closed records count too: they keep their
 * category for reporting, which is why archiving is the way to retire one.
 */
import type { GroupReferences } from "@/lib/group-rules";

export const CATEGORY_IN_USE_CODE = "CATEGORY_IN_USE";
const CATEGORY_IN_USE_ADVICE = "Move those records to another category (or clear their category) and move or remove its subcategories, then delete it.";
const CATEGORY_IN_USE_HINT =
  "Nothing is removed automatically. Tickets, problems and changes count whatever their status, because the category is part of their history. " +
  "To retire a category without deleting it, archive it (PATCH archived: true): it disappears from pickers and the portal, existing records keep it.";

/** The refusal for a category that is still referenced; null when it is safe to delete. */
export function categoryInUseRefusal(references: GroupReferences) {
  if (Object.keys(references).length === 0) return null;
  return {
    message: `The category is still referenced. ${CATEGORY_IN_USE_ADVICE}`,
    code: CATEGORY_IN_USE_CODE,
    references,
    hint: CATEGORY_IN_USE_HINT,
  };
}
