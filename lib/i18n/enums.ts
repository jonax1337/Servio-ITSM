/**
 * Translatable enum labels. The `*_META` maps in lib/constants.ts stay the English source
 * (their `label` is what English renders), and translations live in messages/<locale>/enums.ts
 * keyed by map name and value. Call sites translate at render time:
 *
 *   te(TICKET_STATUS_META[s])            // a meta object from a registered map
 *   te(TICKET_STATUS_META, ticket.status) // map + value (also handles unknown values)
 *
 * Adding a `*_META` map to lib/constants.ts? Register it in ENUM_MAPS below and add its
 * German labels to messages/de/enums.ts — tests/unit/i18n-catalogs.test.ts fails otherwise.
 * Pure and isomorphic (no server-only imports).
 */
import {
  ROLE_META,
  TICKET_TYPE_META,
  TICKET_STATUS_META,
  PENDING_REASON_META,
  RESOLUTION_CODE_META,
  PRIORITY_META,
  LEVEL_META,
  SOURCE_META,
  PROBLEM_STATUS_META,
  CHANGE_TYPE_META,
  CHANGE_STATUS_META,
  CHANGE_OUTCOME_META,
  APPROVAL_META,
  CAB_APPROVAL_RULE_META,
  APPROVAL_ENTITY_META,
  SERVICE_STATUS_META,
  AUTO_ASSIGN_META,
  GROUP_TYPE_META,
  GROUP_MEMBER_ROLE_META,
  ASSET_TYPE_META,
  ASSET_STATUS_META,
  ASSET_RELATION_META,
  SYNC_TYPE_META,
  SYNC_RUN_STATUS_META,
  SLA_STATE_META,
  ESCALATION_ACTION_META,
  ARTICLE_STATUS_META,
  AI_MCP_MODE_META,
  ARTICLE_VISIBILITY_META,
  LOCATION_TYPE_META,
  ONCALL_ROTATION_META,
  RECURRENCE_FREQUENCY_META,
  STATUS_INCIDENT_STATE_META,
  STATUS_INCIDENT_IMPACT_META,
  MAINTENANCE_KIND_META,
  MAINTENANCE_STATUS_META,
  UPDATER_STATE_META,
  RELEASE_STATUS_META,
  CONTRACT_TYPE_META,
  CONTRACT_STATUS_META,
  LICENSE_TYPE_META,
  AI_INSIGHT_KIND_META,
  AI_INSIGHT_STATUS_META,
  metaFor,
  type Meta,
} from "@/lib/constants";
import { FALLBACK_LOCALE, type Locale } from "@/lib/i18n/config";
import { enumCatalogs } from "@/messages";

type Labelled = { label: string; description?: string };

/**
 * Every translatable label map. Aliases (RISK_META = LEVEL_META, CRITICALITY_META =
 * PRIORITY_META) are the same objects, so they are covered by their source map.
 */
export const ENUM_MAPS = {
  ROLE_META,
  TICKET_TYPE_META,
  TICKET_STATUS_META,
  PENDING_REASON_META,
  RESOLUTION_CODE_META,
  PRIORITY_META,
  LEVEL_META,
  SOURCE_META,
  PROBLEM_STATUS_META,
  CHANGE_TYPE_META,
  CHANGE_STATUS_META,
  CHANGE_OUTCOME_META,
  APPROVAL_META,
  CAB_APPROVAL_RULE_META,
  APPROVAL_ENTITY_META,
  SERVICE_STATUS_META,
  AUTO_ASSIGN_META,
  GROUP_TYPE_META,
  GROUP_MEMBER_ROLE_META,
  ASSET_TYPE_META,
  ASSET_STATUS_META,
  ASSET_RELATION_META,
  SYNC_TYPE_META,
  SYNC_RUN_STATUS_META,
  SLA_STATE_META,
  ESCALATION_ACTION_META,
  ARTICLE_STATUS_META,
  AI_MCP_MODE_META,
  ARTICLE_VISIBILITY_META,
  LOCATION_TYPE_META,
  ONCALL_ROTATION_META,
  RECURRENCE_FREQUENCY_META,
  STATUS_INCIDENT_STATE_META,
  STATUS_INCIDENT_IMPACT_META,
  MAINTENANCE_KIND_META,
  MAINTENANCE_STATUS_META,
  UPDATER_STATE_META,
  RELEASE_STATUS_META,
  CONTRACT_TYPE_META,
  CONTRACT_STATUS_META,
  LICENSE_TYPE_META,
  AI_INSIGHT_KIND_META,
  AI_INSIGHT_STATUS_META,
} satisfies Record<string, Record<string, Labelled>>;

export type EnumMapName = keyof typeof ENUM_MAPS;

const mapNames = new WeakMap<object, EnumMapName>();
const metaOrigin = new WeakMap<object, [EnumMapName, string]>();
for (const [name, map] of Object.entries(ENUM_MAPS) as [EnumMapName, Record<string, Labelled>][]) {
  if (!mapNames.has(map)) mapNames.set(map, name);
  for (const [value, meta] of Object.entries(map)) {
    if (!metaOrigin.has(meta)) metaOrigin.set(meta, [name, value]);
  }
}

/** [map name, value] of a meta object from a registered map, or null (e.g. a metaFor fallback). */
export function enumOrigin(meta: object): [EnumMapName, string] | null {
  return metaOrigin.get(meta) ?? null;
}

/** The registered name of a label map, or null. */
export function enumMapName(map: object): EnumMapName | null {
  return mapNames.get(map) ?? null;
}

function lookup(locale: Locale, name: EnumMapName, value: string, field: "label" | "description"): string | null {
  if (locale === FALLBACK_LOCALE) return null;
  const entry = enumCatalogs[locale]?.[name]?.[value];
  if (entry === undefined) return null;
  if (typeof entry === "string") return field === "label" && entry ? entry : null;
  return entry[field] || null;
}

/** Translate a label by map name + value, falling back to `fallback` (the English label). */
export function translateEnumByName(locale: Locale, name: EnumMapName, value: string, fallback: string): string {
  return lookup(locale, name, value, "label") ?? fallback;
}

export type EnumTranslator = {
  /** Label of a meta object (`te(TICKET_STATUS_META[s])`) or of a map + value (`te(MAP, value)`). */
  (metaOrMap: Labelled | Record<string, Labelled>, value?: string | null): string;
  /** The translated `description` of a meta that has one (e.g. AI_MCP_MODE_META). */
  description(meta: Labelled): string;
  /** `{ value, label }` options for every entry of a map, in map order — for selects and filters. */
  options<M extends Record<string, Labelled>>(map: M, values?: readonly string[]): { value: string; label: string }[];
  /** Label by registered map name + value (for serialisable props, see EnumMsg). */
  byName(name: string, value: string, fallback: string): string;
};

function isLabelled(x: unknown): x is Labelled {
  return !!x && typeof x === "object" && typeof (x as Labelled).label === "string";
}

export function createEnumTranslator(locale: Locale): EnumTranslator {
  const labelOf = (meta: Labelled): string => {
    const origin = metaOrigin.get(meta);
    return origin ? (lookup(locale, origin[0], origin[1], "label") ?? meta.label) : meta.label;
  };
  const te = ((metaOrMap: Labelled | Record<string, Labelled>, value?: string | null) => {
    if (value !== undefined || !isLabelled(metaOrMap)) {
      const map = metaOrMap as Record<string, Labelled>;
      const name = mapNames.get(map);
      const meta = value ? map[value] : undefined;
      if (!meta) return metaFor(map as Record<string, Meta>, value).label;
      return name ? (lookup(locale, name, value as string, "label") ?? meta.label) : labelOf(meta);
    }
    return labelOf(metaOrMap);
  }) as EnumTranslator;
  te.description = (meta: Labelled) => {
    const origin = metaOrigin.get(meta);
    const fallback = meta.description ?? "";
    return origin ? (lookup(locale, origin[0], origin[1], "description") ?? fallback) : fallback;
  };
  te.byName = (name, value, fallback) =>
    name in ENUM_MAPS ? translateEnumByName(locale, name as EnumMapName, value, fallback) : fallback;
  te.options = (map, values) =>
    (values ?? Object.keys(map)).map((v) => ({ value: v, label: te(map, v) }));
  return te;
}
