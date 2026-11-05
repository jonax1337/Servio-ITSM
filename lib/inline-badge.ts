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

/**
 * A bare upper-case state in prose (`MEDIUM`, `BREACHED`) when Sable forgot the
 * backticks. Ambiguous values resolve to the earlier map: ticket status before
 * priority before SLA, and so on. NONE and MET are left out: as plain words they
 * are far likelier English than an SLA state.
 */
const BARE_STATE_MAPS = [
  TICKET_STATUS_META,
  PRIORITY_META,
  SLA_STATE_META,
  CHANGE_STATUS_META,
  PROBLEM_STATUS_META,
  CHANGE_TYPE_META,
  TICKET_TYPE_META,
  APPROVAL_META,
  ASSET_STATUS_META,
  ARTICLE_STATUS_META,
];
const BARE_STATE_EXCLUDED = new Set(["NONE", "MET"]);
const BARE_STATES: Record<string, Meta> = Object.assign(
  {},
  ...[...BARE_STATE_MAPS].reverse(),
) as Record<string, Meta>;
for (const value of BARE_STATE_EXCLUDED) delete BARE_STATES[value];

/** Namespace the remark plugin gives a bare state; internal, so not listed in INLINE_BADGE_NAMESPACES. */
const BARE_STATE_NAMESPACE = "state";

const BARE_STATE_PATTERN = new RegExp(
  `(?<![\\w-])(${Object.keys(BARE_STATES)
    .sort((a, b) => b.length - a.length)
    .join("|")})(?![\\w-])`,
  "g",
);

type MdNode = { type: string; value?: string; children?: MdNode[] };

/** Nodes whose text is code, a link, a URL or a heading: never turned into badges. */
const NO_BADGE_PARENTS = new Set(["inlineCode", "code", "link", "linkReference", "html", "heading"]);

/** An all-caps word right before or after the match: a shouted phrase (REQUEST FAILED), not a state. */
const CAPS_BEFORE = /[A-Z]{2,}[\s:,/-]*$/;
const CAPS_AFTER = /^[\s:,/-]*[A-Z]{2,}/;

/** Split one text node into text and `state:VALUE` inline-code nodes at each bare state. */
function splitBareStates(text: string): MdNode[] {
  const out: MdNode[] = [];
  let last = 0;
  for (const match of text.matchAll(BARE_STATE_PATTERN)) {
    const at = match.index ?? 0;
    const end = at + match[1].length;
    if (CAPS_BEFORE.test(text.slice(0, at)) || CAPS_AFTER.test(text.slice(end))) continue;
    if (at > last) out.push({ type: "text", value: text.slice(last, at) });
    out.push({ type: "inlineCode", value: `${BARE_STATE_NAMESPACE}:${match[1]}` });
    last = at + match[1].length;
  }
  if (last < text.length) out.push({ type: "text", value: text.slice(last) });
  return out;
}

function badgeBareStates(node: MdNode): void {
  if (!node.children || NO_BADGE_PARENTS.has(node.type)) return;
  node.children = node.children.flatMap((child) => {
    if (child.type === "text" && child.value) return splitBareStates(child.value);
    badgeBareStates(child);
    return [child];
  });
}

/** Remark plugin: bare upper-case record states in prose render as badges (see the markdown `code` component). */
export function remarkStateBadges() {
  return (tree: MdNode) => badgeBareStates(tree);
}

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
  const map = match[1] === BARE_STATE_NAMESPACE ? BARE_STATES : BADGE_MAPS[match[1]];
  return map?.[match[2].toUpperCase()] ?? null;
}
