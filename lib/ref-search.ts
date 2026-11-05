/** Ids are 32-bit SQLite integers; larger numbers cannot match and make Prisma throw. */
const MAX_ID = 2147483647;

/**
 * List search that also understands record references: "CHG-0025", "chg-25",
 * "#25" and plain "25" all find id 25. Anything else is a title substring match.
 */
export function refSearchWhere(q: string, refPrefix: string) {
  const match = q.trim().match(new RegExp(`^(?:${refPrefix}-|#)?0*(\\d+)$`, "i"));
  const title = { title: { contains: q } };
  const id = match ? Number(match[1]) : NaN;
  return { OR: id >= 1 && id <= MAX_ID ? [title, { id }] : [title] };
}
