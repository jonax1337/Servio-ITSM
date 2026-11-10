import { describe, expect, it } from "vitest";
import {
  asFilter, escapeFilterValue, formatMappingLines, groupLookupFilter, isDistinguishedName, membershipFilter, parseMappingLines,
  NESTED_MATCHING_RULE,
} from "@/lib/connectors/group-mapping";
import { planGroupMembership, planTotals, type DirectoryMapping, type OwnedUser } from "@/lib/connectors/group-plan";

/**
 * The reconcile planner of the directory -> Servio group sync, and the pure helpers around the mapping
 * (config lines, filters). The rules under test are documented at the top of lib/connectors/group-plan.ts.
 */

const user = (n: number, extra: Partial<OwnedUser> = {}): OwnedUser => ({
  id: `u${n}`, externalId: `guid-${n}`, email: `user${n}@example.test`, name: `User ${n}`, ...extra,
});
const alice = user(1);
const bob = user(2);
const carol = user(3);
const owned = [alice, bob, carol];

const mapping = (groupId: string, ids: string[][], over: Partial<DirectoryMapping> = {}): DirectoryMapping => ({
  groupId, label: `dir-${groupId}`, members: ids, complete: true, ...over,
});
const members = (...userIds: string[]) => new Set(userIds);

describe("planGroupMembership", () => {
  it("adds the directory members that are not in the group yet", () => {
    const [plan] = planGroupMembership({ mappings: [mapping("g1", [["guid-1"], ["guid-2"]])], owned, current: new Map([["g1", members("u1")]]) });
    expect(plan.adds.map((u) => u.userId)).toEqual(["u2"]);
    expect(plan.removes).toEqual([]);
  });

  it("removes imported users the directory group no longer has", () => {
    const [plan] = planGroupMembership({ mappings: [mapping("g1", [["guid-1"]])], owned, current: new Map([["g1", members("u1", "u2")]]) });
    expect(plan.adds).toEqual([]);
    expect(plan.removes.map((u) => u.userId)).toEqual(["u2"]);
  });

  it("does nothing when the group already matches", () => {
    const [plan] = planGroupMembership({ mappings: [mapping("g1", [["guid-1"], ["guid-2"]])], owned, current: new Map([["g1", members("u1", "u2")]]) });
    expect(plan.adds).toEqual([]);
    expect(plan.removes).toEqual([]);
    expect(planTotals([plan])).toEqual({ added: 0, removed: 0, heldBack: 0 });
  });

  it("leaves members alone who were not imported by this source (added by hand, local, other source)", () => {
    // u9 is a member of g1 but not one of the source's users: never removed, never counted.
    const [plan] = planGroupMembership({ mappings: [mapping("g1", [["guid-1"]])], owned, current: new Map([["g1", members("u1", "u9", "u8")]]) });
    expect(plan.removes).toEqual([]);
    expect(plan.adds).toEqual([]);
  });

  it("the directory wins for an imported user: a hand-added membership is removed when the directory group lacks them", () => {
    const [plan] = planGroupMembership({ mappings: [mapping("g1", [])], owned, current: new Map([["g1", members("u3")]]) });
    expect(plan.removes.map((u) => u.userId)).toEqual(["u3"]);
  });

  it("matches a user by any of the id forms the directory lists (current form first, then earlier forms)", () => {
    // The user import has not moved bob to the canonical id yet (preview before a run): the old form still matches.
    const oldForm = user(2, { externalId: "legacyhex2" });
    const [plan] = planGroupMembership({ mappings: [mapping("g1", [["guid-2", "legacyhex2"]])], owned: [alice, oldForm], current: new Map() });
    expect(plan.adds.map((u) => u.userId)).toEqual(["u2"]);
    expect(plan.pendingNew).toBe(0);
  });

  it("counts directory members that are no imported users (yet) once, not per id form", () => {
    const [plan] = planGroupMembership({ mappings: [mapping("g1", [["guid-1"], ["guid-77", "legacy77"], ["guid-78"]])], owned, current: new Map() });
    expect(plan.pendingNew).toBe(2);
    expect(plan.adds.map((u) => u.userId)).toEqual(["u1"]);
  });

  it("holds removals back for a group while a mapped directory group could not be read, but still adds", () => {
    const plans = planGroupMembership({
      mappings: [mapping("g1", [["guid-2"]]), mapping("g1", [], { complete: false, label: "broken" })],
      owned,
      current: new Map([["g1", members("u1")]]),
    });
    expect(plans).toHaveLength(1);
    expect(plans[0].adds.map((u) => u.userId)).toEqual(["u2"]);
    expect(plans[0].removes).toEqual([]);
    expect(plans[0].heldBack).toBe(1);
    expect(planTotals(plans)).toEqual({ added: 1, removed: 0, heldBack: 1 });
  });

  it("an unreadable group alone never empties the Servio group", () => {
    const [plan] = planGroupMembership({ mappings: [mapping("g1", [], { complete: false })], owned, current: new Map([["g1", members("u1", "u2", "u3")]]) });
    expect(plan.removes).toEqual([]);
    expect(plan.heldBack).toBe(3);
  });

  it("several directory groups mapped to one Servio group: the membership is their union", () => {
    const [plan] = planGroupMembership({
      mappings: [mapping("g1", [["guid-1"]]), mapping("g1", [["guid-2"]])],
      owned,
      current: new Map([["g1", members("u2", "u3")]]),
    });
    expect(plan.directoryGroups).toEqual(["dir-g1", "dir-g1"]);
    expect(plan.adds.map((u) => u.userId)).toEqual(["u1"]);
    expect(plan.removes.map((u) => u.userId)).toEqual(["u3"]);
  });

  it("plans each Servio group on its own and sorts the users by address", () => {
    const plans = planGroupMembership({
      mappings: [mapping("g1", [["guid-3"], ["guid-1"]]), mapping("g2", [["guid-2"]])],
      owned,
      current: new Map([["g2", members("u1")]]),
    });
    expect(plans.map((p) => p.groupId)).toEqual(["g1", "g2"]);
    expect(plans[0].adds.map((u) => u.email)).toEqual(["user1@example.test", "user3@example.test"]);
    expect(plans[1].adds.map((u) => u.userId)).toEqual(["u2"]);
    expect(plans[1].removes.map((u) => u.userId)).toEqual(["u1"]);
  });

  it("is idempotent: planning again after applying the plan yields nothing", () => {
    const m = [mapping("g1", [["guid-1"], ["guid-3"]])];
    const first = planGroupMembership({ mappings: m, owned, current: new Map([["g1", members("u2")]]) })[0];
    const after = new Set(["u2", ...first.adds.map((u) => u.userId)]);
    for (const r of first.removes) after.delete(r.userId);
    const again = planGroupMembership({ mappings: m, owned, current: new Map([["g1", after]]) })[0];
    expect(again.adds).toEqual([]);
    expect(again.removes).toEqual([]);
  });

  it("without any mapping there is nothing to do", () => {
    expect(planGroupMembership({ mappings: [], owned, current: new Map() })).toEqual([]);
  });
});

describe("mapping lines", () => {
  it("parses one mapping per line, ignoring blank lines and comments, and drops exact duplicates", () => {
    const { mappings, errors } = parseMappingLines(
      "CN=IT Support,OU=Groups,DC=corp,DC=local => service-desk\n\n# a comment\nNetwork Team=>net\r\ncn=it support,ou=groups,dc=corp,dc=local => service-desk\n",
    );
    expect(errors).toEqual([]);
    expect(mappings).toEqual([
      { directoryGroup: "CN=IT Support,OU=Groups,DC=corp,DC=local", group: "service-desk" },
      { directoryGroup: "Network Team", group: "net" },
    ]);
  });

  it("reports a line that is not a mapping, with its number", () => {
    const { mappings, errors } = parseMappingLines("good => g1\nno separator here\n => g2\nname =>");
    expect(mappings).toEqual([{ directoryGroup: "good", group: "g1" }]);
    expect(errors.map((e) => e.slice(0, 7))).toEqual(["Line 2:", "Line 3:", "Line 4:"]);
  });

  it("round-trips through the form text", () => {
    const list = [{ directoryGroup: "CN=A,DC=x", group: "one" }, { directoryGroup: "Team B", group: "two" }];
    expect(parseMappingLines(formatMappingLines(list)).mappings).toEqual(list);
  });
});

describe("directory filters", () => {
  it("tells a distinguished name from a group name", () => {
    expect(isDistinguishedName("CN=IT,OU=Groups,DC=corp,DC=local")).toBe(true);
    expect(isDistinguishedName("cn=it,ou=groups,dc=example,dc=com")).toBe(true);
    expect(isDistinguishedName("IT Support")).toBe(false);
    expect(isDistinguishedName("Team A")).toBe(false);
  });

  it("escapes filter values (RFC 4515)", () => {
    expect(escapeFilterValue("a*b(c)d\\e")).toBe("a\\2ab\\28c\\29d\\5ce");
    expect(escapeFilterValue("plain")).toBe("plain");
  });

  it("builds the membership filter, with the in-chain rule only for nested groups", () => {
    const dn = "CN=IT\\, Support,OU=Groups,DC=corp,DC=local";
    expect(membershipFilter("(objectClass=user)", dn, false)).toBe("(&(objectClass=user)(memberOf=CN=IT\\5c, Support,OU=Groups,DC=corp,DC=local))");
    expect(membershipFilter("objectClass=user", dn, true)).toContain(`(memberOf:${NESTED_MATCHING_RULE}:=`);
    expect(asFilter("a=b")).toBe("(a=b)");
    expect(asFilter(" (a=b) ")).toBe("(a=b)");
  });

  it("cannot be broken out of by a hostile group name", () => {
    const filter = groupLookupFilter("x)(objectClass=*");
    expect(filter).not.toContain("x)(objectClass=*");
    expect(filter).toContain("x\\29\\28objectClass=\\2a");
  });
});
