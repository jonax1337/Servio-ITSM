import { describe, expect, it } from "vitest";
import type { Entry, SearchOptions } from "ldapts";
import { fetchDirectoryGroups, type DirectoryClient, type DirectoryGroupConfig } from "@/lib/connectors/ldap-groups";
import { entryIdForms } from "@/lib/connectors/ldap-identifiers";

/** The directory side of the group sync, against a fake directory. */

const cfg: DirectoryGroupConfig = {
  baseDN: "DC=corp,DC=local",
  groupBaseDN: "",
  userFilter: "(objectCategory=person)",
  searchScope: "sub",
  pageSize: 500,
  externalId: "objectGUID",
  groupNested: false,
};

const GUID_BYTES = Buffer.from([0xc9, 0x8b, 0x91, 0x35, 0x6d, 0x19, 0xea, 0x40, 0x97, 0x79, 0x88, 0x9d, 0x79, 0xb7, 0x53, 0xf0]);
const GUID = "35918bc9-196d-40ea-9779-889d79b753f0";
const LEGACY = "c98b91356d19ea409779889d79b753f0";

type Call = { base: string; options: SearchOptions };

/** A fake directory: answers each search by a function of (base, options), and records the searches. */
function directory(answer: (base: string, options: SearchOptions) => Entry[] | Error) {
  const calls: Call[] = [];
  const client: DirectoryClient = {
    search: async (base, options) => {
      calls.push({ base, options });
      const result = answer(base, options);
      if (result instanceof Error) throw result;
      return { searchEntries: result };
    },
  };
  return { client, calls };
}

const group = (dn: string, extra: Record<string, unknown> = {}) => ({ dn, member: ["CN=x"], ...extra }) as unknown as Entry;
const person = (dn: string, guid: Buffer = GUID_BYTES) => ({ dn, objectGUID: guid }) as unknown as Entry;

describe("entryIdForms", () => {
  it("returns the canonical GUID first and the hex of earlier releases after it", () => {
    expect(entryIdForms({ objectGUID: GUID_BYTES }, "objectGUID")).toEqual([GUID, LEGACY]);
  });
  it("returns a text value as it is and an empty list for a missing one", () => {
    expect(entryIdForms({ entryUUID: ["abc"] }, "entryUUID")).toEqual(["abc"]);
    expect(entryIdForms({}, "entryUUID")).toEqual([]);
    expect(entryIdForms({ entryUUID: "" }, "entryUUID")).toEqual([]);
  });
});

describe("fetchDirectoryGroups", () => {
  it("reads a group by distinguished name and lists its users by the ids the import uses", async () => {
    const dn = "CN=IT,OU=Groups,DC=corp,DC=local";
    const { client, calls } = directory((base, o) => {
      if (o.scope === "base") return [group(dn)];
      return [person("CN=alice,DC=corp,DC=local")];
    });
    const [result] = await fetchDirectoryGroups(client, cfg, [{ directoryGroup: dn, group: "g1" }]);
    expect(result).toMatchObject({ ok: true, dn, members: [[GUID, LEGACY]] });
    // First the group itself (base scope), then the users with memberOf, asking for the id as a Buffer.
    expect(calls[0]).toMatchObject({ base: dn, options: { scope: "base" } });
    expect(calls[1].base).toBe(cfg.baseDN);
    expect(calls[1].options.filter).toBe(`(&(objectCategory=person)(memberOf=${dn}))`);
    expect(calls[1].options.explicitBufferAttributes).toEqual(["objectGUID"]);
  });

  it("looks a group up by name under the group search base (else the base DN) and uses the DN the directory reports", async () => {
    const { client, calls } = directory((base, o) => {
      if (o.scope === "sub" && String(o.filter).includes("objectClass=group")) return [group("CN=Network,OU=Groups,DC=corp,DC=local")];
      return [person("CN=bob,DC=corp,DC=local")];
    });
    const [byDefault] = await fetchDirectoryGroups(client, cfg, [{ directoryGroup: "Network", group: "g2" }]);
    expect(byDefault).toMatchObject({ ok: true, dn: "CN=Network,OU=Groups,DC=corp,DC=local" });
    expect(calls[0].base).toBe("DC=corp,DC=local");
    const lookedUp = await fetchDirectoryGroups(client, { ...cfg, groupBaseDN: "OU=Groups,DC=corp,DC=local" }, [{ directoryGroup: "Network", group: "g2" }]);
    expect(lookedUp[0].ok).toBe(true);
    expect(calls[2].base).toBe("OU=Groups,DC=corp,DC=local");
    expect(calls[3].options.filter).toContain("memberOf=CN=Network,OU=Groups,DC=corp,DC=local");
  });

  it("uses the in-chain matching rule for nested groups", async () => {
    const { client, calls } = directory((base, o) => (o.scope === "base" ? [group("CN=IT,DC=corp,DC=local")] : [person("CN=alice,DC=corp,DC=local")]));
    await fetchDirectoryGroups(client, { ...cfg, groupNested: true }, [{ directoryGroup: "CN=IT,DC=corp,DC=local", group: "g1" }]);
    expect(String(calls[1].options.filter)).toContain("memberOf:1.2.840.113556.1.4.1941:=CN=IT,DC=corp,DC=local");
  });

  it("reports a group that does not exist, or whose name is ambiguous, and keeps going with the others", async () => {
    const { client } = directory((base, o) => {
      if (o.scope === "base") return new Error("No Such Object");
      const filter = String(o.filter);
      if (filter.includes("Twin")) return [group("CN=Twin,OU=A,DC=x"), group("CN=Twin,OU=B,DC=x")];
      if (filter.includes("Ghost")) return [];
      return [person("CN=alice,DC=corp,DC=local")];
    });
    const results = await fetchDirectoryGroups(client, cfg, [
      { directoryGroup: "CN=Missing,DC=corp,DC=local", group: "g1" },
      { directoryGroup: "Ghost", group: "g2" },
      { directoryGroup: "Twin", group: "g3" },
    ]);
    expect(results.map((r) => r.ok)).toEqual([false, false, false]);
    expect(results[0]).toMatchObject({ error: expect.stringContaining("was not found") });
    expect(results[1]).toMatchObject({ error: expect.stringContaining("was not found under DC=corp,DC=local") });
    expect(results[2]).toMatchObject({ error: expect.stringContaining("not unique") });
  });

  it("treats an empty answer for a group that has members as untrustworthy, not as an empty group", async () => {
    // A directory without memberOf answers the membership query with nothing although the group lists members.
    const { client } = directory((base, o) => (o.scope === "base" ? [group("CN=IT,DC=corp,DC=local")] : []));
    const [result] = await fetchDirectoryGroups(client, cfg, [{ directoryGroup: "CN=IT,DC=corp,DC=local", group: "g1" }]);
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining("has members but none of them matched") });
  });

  it("accepts a genuinely empty group, including one whose members come in ranges", async () => {
    const { client } = directory((base, o) => (o.scope === "base" ? [{ dn: "CN=Empty,DC=corp,DC=local" } as unknown as Entry] : []));
    const [empty] = await fetchDirectoryGroups(client, cfg, [{ directoryGroup: "CN=Empty,DC=corp,DC=local", group: "g1" }]);
    expect(empty).toMatchObject({ ok: true, members: [] });
    // Active Directory names the attribute member;range=0-1499 for a big group: still "has members".
    const ranged = directory((base, o) => (o.scope === "base" ? [{ dn: "CN=Big,DC=corp,DC=local", "member;range=0-1499": ["CN=a"] } as unknown as Entry] : []));
    const [big] = await fetchDirectoryGroups(ranged.client, cfg, [{ directoryGroup: "CN=Big,DC=corp,DC=local", group: "g1" }]);
    expect(big.ok).toBe(false);
  });

  it("reports a failing membership query for that group only", async () => {
    const { client } = directory((base, o) => {
      if (o.scope === "base") return [group("CN=IT,DC=corp,DC=local")];
      return new Error("unsupported extended match");
    });
    const [result] = await fetchDirectoryGroups(client, { ...cfg, groupNested: true }, [{ directoryGroup: "CN=IT,DC=corp,DC=local", group: "g1" }]);
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining("unsupported extended match") });
  });
});
