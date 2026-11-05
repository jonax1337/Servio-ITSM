import {
  APPROVAL_META,
  ARTICLE_STATUS_META,
  ASSET_STATUS_META,
  CHANGE_STATUS_META,
  CHANGE_TYPE_META,
  LEVEL_META,
  PRIORITY_META,
  PROBLEM_STATUS_META,
  SLA_STATE_META,
  TICKET_STATUS_META,
  TICKET_TYPE_META,
  type Meta,
} from "@/lib/constants";

/**
 * Sable writes record states as namespaced inline code, e.g. `status:OPEN` or
 * `priority:HIGH`, and the chat renders them as the same tone badges the lists
 * use. The namespace is required because bare values are ambiguous (APPROVED is
 * both a change status and an approval decision, MEDIUM both a priority and a risk).
 */
const BADGE_MAPS: Record<string, Record<string, Meta>> = {
  status: TICKET_STATUS_META,
  priority: PRIORITY_META,
  impact: LEVEL_META,
  urgency: LEVEL_META,
  risk: LEVEL_META,
  sla: SLA_STATE_META,
  problem: PROBLEM_STATUS_META,
  change: CHANGE_STATUS_META,
  "change-type": CHANGE_TYPE_META,
  // Ticket and change types share no values, so a plain `type:` resolves either.
  type: { ...TICKET_TYPE_META, ...CHANGE_TYPE_META },
  approval: APPROVAL_META,
  asset: ASSET_STATUS_META,
  article: ARTICLE_STATUS_META,
};

export const INLINE_BADGE_NAMESPACES = Object.keys(BADGE_MAPS);

const RECORD_PATHS: Record<string, string> = { INC: "/tickets", REQ: "/tickets", PRB: "/problems", CHG: "/changes" };

/** The page of a record ref written as inline code (`INC-0142`, `CHG-0039`), or null when it is not one. */
export function recordRefHref(token: string): string | null {
  const match = /^(INC|REQ|PRB|CHG)-0*(\d+)$/i.exec(token.trim());
  return match ? `${RECORD_PATHS[match[1].toUpperCase()]}/${match[2]}` : null;
}

/** The badge for an inline-code token like `priority:HIGH`, or null when it is ordinary code. */
export function inlineBadgeMeta(token: string): Meta | null {
  const match = /^([a-z-]+):([A-Za-z_]+)$/.exec(token.trim());
  if (!match) return null;
  const map = BADGE_MAPS[match[1]];
  return map?.[match[2].toUpperCase()] ?? null;
}
