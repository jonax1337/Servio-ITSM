import { z } from "zod";

/**
 * Directory group -> Servio group mapping of an LDAP / Active Directory sync source. Pure and DB-free
 * (no server imports): shared by the connector, the source form and the unit tests.
 *
 * A source maps directory groups to Servio groups. On every run the Servio group membership of the
 * users that source imported is reconciled to the directory group (see lib/connectors/group-plan.ts).
 */

/** One mapping: `directoryGroup` is a DN (`CN=IT,OU=Groups,DC=corp,DC=local`) or a group name; `group` a Servio group id or import ref. */
export const groupMappingSchema = z.object({
  directoryGroup: z.string().trim().min(1).max(500),
  group: z.string().trim().min(1).max(200),
});
export type GroupMapping = z.infer<typeof groupMappingSchema>;

export const MAX_GROUP_MAPPINGS = 200;

/** Separates the two sides of a mapping line in the form: `<directory group> => <Servio group>`. */
export const MAPPING_SEPARATOR = "=>";

export function parseMappingLines(text: string): { mappings: GroupMapping[]; errors: string[] } {
  const mappings: GroupMapping[] = [];
  const errors: string[] = [];
  const seen = new Set<string>();
  text.split(/\r?\n/).forEach((raw, index) => {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) return;
    const at = line.indexOf(MAPPING_SEPARATOR);
    const directoryGroup = at < 0 ? "" : line.slice(0, at).trim();
    const group = at < 0 ? "" : line.slice(at + MAPPING_SEPARATOR.length).trim();
    if (!directoryGroup || !group) {
      errors.push(`Line ${index + 1}: expected "<directory group DN or name> ${MAPPING_SEPARATOR} <Servio group id or import ref>".`);
      return;
    }
    const parsed = groupMappingSchema.safeParse({ directoryGroup, group });
    if (!parsed.success) {
      errors.push(`Line ${index + 1}: ${parsed.error.issues[0]?.message ?? "invalid mapping"}.`);
      return;
    }
    const key = `${parsed.data.directoryGroup.toLowerCase()}\u0000${parsed.data.group}`;
    if (seen.has(key)) return;
    seen.add(key);
    mappings.push(parsed.data);
  });
  if (mappings.length > MAX_GROUP_MAPPINGS) errors.push(`At most ${MAX_GROUP_MAPPINGS} group mappings are supported.`);
  return { mappings, errors };
}

export function formatMappingLines(mappings: readonly GroupMapping[]): string {
  return mappings.map((m) => `${m.directoryGroup} ${MAPPING_SEPARATOR} ${m.group}`).join("\n");
}

/** A value that starts with an attribute type and `=` (`CN=`, `cn=`, `ou=` ...) is a distinguished name; anything else is a group name. */
export function isDistinguishedName(value: string): boolean {
  return /^[A-Za-z][A-Za-z0-9-]*\s*=\s*\S/.test(value.trim());
}

/** Escapes a value for use in an LDAP search filter (RFC 4515). */
export function escapeFilterValue(value: string): string {
  return value.replace(/[\\*()\u0000]/g, (c) => `\\${c.charCodeAt(0).toString(16).padStart(2, "0")}`);
}

/** Active Directory's LDAP_MATCHING_RULE_IN_CHAIN: follows nested group membership server side. */
export const NESTED_MATCHING_RULE = "1.2.840.113556.1.4.1941";

/** A user filter as a parenthesised filter expression (the form accepts both `(a=b)` and `a=b`). */
export function asFilter(filter: string): string {
  const f = filter.trim();
  return f.startsWith("(") ? f : `(${f})`;
}

/** The users matching `userFilter` that are members of `groupDn` (directly, or through nested groups with `nested`). */
export function membershipFilter(userFilter: string, groupDn: string, nested: boolean): string {
  const attribute = nested ? `memberOf:${NESTED_MATCHING_RULE}:` : "memberOf";
  return `(&${asFilter(userFilter)}(${attribute}=${escapeFilterValue(groupDn)}))`;
}

/** Looks a directory group up by its name (`cn` or the Active Directory account name). */
export function groupLookupFilter(name: string): string {
  const value = escapeFilterValue(name.trim());
  return `(&(|(objectClass=group)(objectClass=groupOfNames)(objectClass=groupOfUniqueNames))(|(cn=${value})(sAMAccountName=${value})))`;
}
