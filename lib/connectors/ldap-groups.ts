import type { Entry, SearchOptions } from "ldapts";
import {
  groupLookupFilter, isDistinguishedName, membershipFilter, type GroupMapping,
} from "./group-mapping";
import { entryIdForms, isBinaryAttr } from "./ldap-identifiers";

/**
 * The directory side of the group sync: resolve each configured directory group and list the users in it.
 * It talks to the directory through the small `DirectoryClient` interface (an ldapts Client satisfies it),
 * so the logic is tested with a fake directory. No database access here.
 *
 * Membership is read from the user side: for a mapped group the users matching the source's user filter
 * and `memberOf=<group DN>` (with Active Directory's in-chain matching rule when nested groups are on).
 * That avoids reading a huge `member` attribute (Active Directory answers only 1500 values at a time) and
 * returns the same external ids the user import uses. It needs a directory that maintains `memberOf`
 * (Active Directory does; OpenLDAP needs the memberof overlay): when a group has members but the query
 * finds none, the result is flagged as not trustworthy instead of being treated as an empty group.
 */

export interface DirectoryClient {
  search(base: string, options: SearchOptions): Promise<{ searchEntries: Entry[] }>;
}

export type DirectoryGroupConfig = {
  baseDN: string;
  /** Where a group given by name is looked up; blank = baseDN. */
  groupBaseDN: string;
  userFilter: string;
  searchScope: "sub" | "one";
  pageSize: number;
  /** The attribute the user import stores as external id (objectGUID, entryUUID ...). */
  externalId: string;
  /** Follow nested groups (Active Directory only). */
  groupNested: boolean;
};

export type FetchedDirectoryGroup =
  | { ok: true; mapping: GroupMapping; dn: string; members: string[][]; warning?: string }
  | { ok: false; mapping: GroupMapping; error: string };

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const MEMBER_ATTRIBUTES = ["member", "uniqueMember"];

/** Whether a group entry lists members at all (Active Directory may name the attribute `member;range=0-1499`). */
function entryHasMembers(entry: Entry): boolean {
  return Object.entries(entry).some(([key, value]) => {
    if (key !== "member" && key !== "uniqueMember" && !key.startsWith("member;") && !key.startsWith("uniqueMember;")) return false;
    return Array.isArray(value) ? value.length > 0 : value != null && value !== "";
  });
}

type ResolvedGroup = { dn: string; hasMembers: boolean };

async function resolveGroup(client: DirectoryClient, cfg: DirectoryGroupConfig, ref: string): Promise<ResolvedGroup | { error: string }> {
  if (isDistinguishedName(ref)) {
    let entries: Entry[];
    try {
      ({ searchEntries: entries } = await client.search(ref.trim(), { scope: "base", filter: "(objectClass=*)", attributes: MEMBER_ATTRIBUTES, paged: false }));
    } catch (e) {
      return { error: /no such object/i.test(errText(e)) ? `Directory group "${ref}" was not found.` : `Could not read directory group "${ref}": ${errText(e)}` };
    }
    const entry = entries[0];
    return entry ? { dn: entry.dn, hasMembers: entryHasMembers(entry) } : { error: `Directory group "${ref}" was not found.` };
  }
  let entries: Entry[];
  try {
    ({ searchEntries: entries } = await client.search(cfg.groupBaseDN || cfg.baseDN, {
      scope: "sub", filter: groupLookupFilter(ref), attributes: MEMBER_ATTRIBUTES, sizeLimit: 3, paged: false,
    }));
  } catch (e) {
    // A size limit is not an error here: three hits are already one too many and are reported below.
    if (!/size limit/i.test(errText(e))) return { error: `Could not look up directory group "${ref}": ${errText(e)}` };
    return { error: `Directory group name "${ref}" is not unique. Use its distinguished name.` };
  }
  if (entries.length === 0) return { error: `Directory group "${ref}" was not found under ${cfg.groupBaseDN || cfg.baseDN}.` };
  if (entries.length > 1) return { error: `Directory group name "${ref}" is not unique (${entries.map((e) => e.dn).join("; ")}). Use its distinguished name.` };
  return { dn: entries[0].dn, hasMembers: entryHasMembers(entries[0]) };
}

/**
 * Resolve every mapped directory group and list its users (as the id forms the user import knows them by).
 * A group that cannot be resolved or read comes back as `ok: false` with the reason; it never throws.
 */
export async function fetchDirectoryGroups(
  client: DirectoryClient,
  cfg: DirectoryGroupConfig,
  mappings: readonly GroupMapping[],
): Promise<FetchedDirectoryGroup[]> {
  const out: FetchedDirectoryGroup[] = [];
  for (const mapping of mappings) {
    const group = await resolveGroup(client, cfg, mapping.directoryGroup);
    if ("error" in group) {
      out.push({ ok: false, mapping, error: group.error });
      continue;
    }
    try {
      const { searchEntries } = await client.search(cfg.baseDN, {
        scope: cfg.searchScope,
        filter: membershipFilter(cfg.userFilter, group.dn, cfg.groupNested),
        paged: { pageSize: cfg.pageSize },
        attributes: [cfg.externalId],
        explicitBufferAttributes: isBinaryAttr(cfg.externalId) ? [cfg.externalId] : [],
      });
      const members = searchEntries.map((e) => entryIdForms(e, cfg.externalId)).filter((forms) => forms.length > 0);
      if (members.length === 0 && group.hasMembers) {
        out.push({
          ok: false,
          mapping,
          error:
            `Directory group "${group.dn}" has members but none of them matched the user filter with memberOf. ` +
            "The directory may not maintain memberOf, the members may be outside the base DN or only nested groups (see Include nested groups): the membership was left unchanged.",
        });
        continue;
      }
      out.push({ ok: true, mapping, dn: group.dn, members });
    } catch (e) {
      out.push({ ok: false, mapping, error: `Could not list the members of "${group.dn}": ${errText(e)}` });
    }
  }
  return out;
}
