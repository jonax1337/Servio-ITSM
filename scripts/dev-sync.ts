/**
 * Dev-only: exercise the sync connectors headless, without the console UI.
 *
 *   pnpm exec tsx --env-file=.env scripts/dev-sync.ts --list
 *   pnpm exec tsx --env-file=.env scripts/dev-sync.ts --test "Corporate AD"
 *   pnpm exec tsx --env-file=.env scripts/dev-sync.ts --run  "Corporate AD"
 *   pnpm exec tsx --env-file=.env scripts/dev-sync.ts --demo            # real run vs. public test LDAP
 *   pnpm exec tsx --env-file=.env scripts/dev-sync.ts --csvdemo         # real CSV run vs. the DB, then cleans up
 *   pnpm exec tsx --env-file=.env scripts/dev-sync.ts --selftest        # offline checks (mapping, CSV, REST path, cron)
 *
 * --demo creates/updates a throwaway source ("Dev LDAP (forumsys)") pointing at
 * the public ldap.forumsys.com server (note: that server is dead — use a real AD)
 * and runs it end-to-end. --csvdemo imports 3 inline rows into the DB and then
 * deletes them + the source. Runs that store a secret need SETTINGS_ENCRYPTION_KEY.
 */
import { db } from "@/lib/db";
import { getConnector } from "@/lib/connectors";
import { mapEntry } from "@/lib/connectors/ldap";
import { parseCsv } from "@/lib/connectors/csv";
import { getByPath } from "@/lib/connectors/rest";
import { isSyncDue } from "@/lib/scheduler";
import { encryptionAvailable, encryptSecret } from "@/lib/crypto";
import type { SyncSource } from "@prisma/client";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
function has(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

async function findSource(idOrName: string): Promise<SyncSource | null> {
  return (
    (await db.syncSource.findUnique({ where: { id: idOrName } })) ??
    (await db.syncSource.findUnique({ where: { name: idOrName } }))
  );
}

async function ensureDemoSource(): Promise<SyncSource> {
  if (!encryptionAvailable()) {
    throw new Error("SETTINGS_ENCRYPTION_KEY is not set — required to store the bind password.");
  }
  const config = {
    url: "ldap://ldap.forumsys.com:389",
    baseDN: "dc=example,dc=com",
    bindDN: "cn=read-only-admin,dc=example,dc=com",
    bindPassword: encryptSecret("password"),
    userFilter: "(objectClass=inetOrgPerson)",
    scope: "sub",
    pageSize: 200,
    tlsRejectUnauthorized: true,
    deactivateMissing: false,
    externalId: "uid",
    email: "mail",
    name: "cn",
    jobTitle: "",
    phone: "telephoneNumber",
    department: "",
  };
  const name = "Dev LDAP (forumsys)";
  return db.syncSource.upsert({
    where: { name },
    create: { name, type: "LDAP", direction: "IMPORT", scope: "USERS", config: JSON.stringify(config) },
    update: { config: JSON.stringify(config) },
  });
}

/** Deterministic, offline checks across the connector pipeline. */
function selftest(): void {
  const map = {
    externalId: "objectGUID",
    email: "mail",
    name: "displayName",
    jobTitle: "title",
    phone: "telephoneNumber",
    department: "department",
  };
  let pass = 0;
  let fail = 0;
  const check = (name: string, cond: boolean) => {
    if (cond) pass++;
    else {
      fail++;
      console.log(`  ✗ ${name}`);
    }
  };

  // LDAP: binary objectGUID (Buffer) → canonical GUID text; array-valued mail → first.
  const guid = Buffer.from("c98b91356d19ea409779889d79b753f0", "hex");
  const ad = mapEntry(
    {
      dn: "CN=Alice,DC=corp",
      objectGUID: guid,
      mail: ["alice@corp.local", "alias@corp.local"],
      displayName: "Alice Doe",
      title: "Engineer",
      telephoneNumber: "",
    } as never,
    map,
  );
  check("AD entry maps", !("error" in ad));
  if (!("error" in ad)) {
    check("objectGUID → canonical GUID", ad.externalId === "35918bc9-196d-40ea-9779-889d79b753f0");
    check("objectGUID keeps the legacy hex for matching", ad.legacyExternalIds?.[0] === guid.toString("hex"));
    check("array mail → first, lowercased", ad.email === "alice@corp.local");
    check("displayName → name", ad.name === "Alice Doe");
    check("title → jobTitle", ad.jobTitle === "Engineer");
    check("mapped-but-empty phone → null", ad.phone === null);
  }
  check("missing email → error", "error" in mapEntry({ dn: "CN=Bob", objectGUID: "abc" } as never, map));
  check("missing external id → error", "error" in mapEntry({ dn: "CN=Carol", mail: "c@x.com" } as never, map));

  // CSV: quoted field containing the delimiter + escaped quotes.
  const rows = parseCsv('id,email,name\r\n1,a@x.com,"Doe, Alice"\n2,b@x.com,"Bob ""B"""', ",");
  check("csv row count", rows.length === 3);
  check("csv quoted comma", rows[1]?.[2] === "Doe, Alice");
  check("csv escaped quote", rows[2]?.[2] === 'Bob "B"');

  // REST: dot-path extraction (incl. NetBox-style nested asset field).
  check("getByPath nested", getByPath({ a: { b: { c: 7 } } }, "a.b.c") === 7);
  check("getByPath missing → undefined", getByPath({ a: {} }, "a.b.c") === undefined);
  check(
    "getByPath netbox device_type.model",
    getByPath({ device_type: { model: "PowerEdge R740" } }, "device_type.model") === "PowerEdge R740",
  );

  // Cron scheduling: isSyncDue.
  const now = new Date("2026-08-11T12:30:00Z");
  const hourly = "0 * * * *";
  check(
    "hourly due when lastRun was 2h ago",
    isSyncDue(hourly, new Date("2026-08-11T10:00:00Z"), now) === true,
  );
  check(
    "hourly NOT due when lastRun was this hour",
    isSyncDue(hourly, new Date("2026-08-11T12:00:00Z"), now) === false,
  );
  check("never-run scheduled source is due", isSyncDue(hourly, null, now) === true);
  check("invalid cron never fires", isSyncDue("not a cron", null, now) === false);

  console.log(`selftest: ${pass} passed, ${fail} failed`);
  if (fail) process.exitCode = 1;
}

/** Real end-to-end run of the CSV connector against the DB, then clean up. */
async function csvDemo(): Promise<void> {
  const name = "Dev CSV (inline)";
  const config = {
    mode: "inline",
    data: "id,email,name,dept\ncsv-1,alice@dev.local,Alice Demo,IT\ncsv-2,,Bob NoEmail,IT\ncsv-3,carol@dev.local,Carol Demo,HR",
    delimiter: ",",
    hasHeader: true,
    deactivateMissing: false,
    externalId: "id",
    email: "email",
    name: "name",
    jobTitle: "",
    phone: "",
    department: "dept",
  };
  const source = await db.syncSource.upsert({
    where: { name },
    create: { name, type: "CSV", direction: "IMPORT", scope: "USERS", config: JSON.stringify(config) },
    update: { config: JSON.stringify(config) },
  });
  try {
    const connector = getConnector("CSV")!;
    const result = await connector.run(source, { trigger: "MANUAL" });
    console.log(result.log);
    console.log(`status=${result.status} created=${result.created} updated=${result.updated} failed=${result.failed}`);
    const imported = await db.user.findMany({
      where: { syncSourceId: source.id },
      select: { email: true, name: true, department: true },
    });
    console.log("imported users:", JSON.stringify(imported));
  } finally {
    // Clean up so the dev DB keeps no residue.
    const del = await db.user.deleteMany({ where: { syncSourceId: source.id } });
    await db.syncSource.delete({ where: { id: source.id } });
    console.log(`cleaned up ${del.count} user(s) + source`);
  }
}

/** Real end-to-end run of a scope=ASSETS CSV import against the DB, then clean up. */
async function assetDemo(): Promise<void> {
  const name = "Dev CSV assets (inline)";
  const config = {
    mode: "inline",
    data:
      "id,name,serial,model,type,status\n" +
      "a-1,web01,SN123,PowerEdge R740,SERVER,IN_USE\n" +
      "a-2,,SN124,PowerEdge R740,SERVER,IN_USE\n" +
      "a-3,db01,SN125,PowerEdge R750,SERVER,IN_USE",
    delimiter: ",",
    hasHeader: true,
    deactivateMissing: false,
    externalId: "id",
    name: "name",
    serial: "serial",
    model: "model",
    type: "type",
    status: "status",
  };
  const source = await db.syncSource.upsert({
    where: { name },
    create: { name, type: "CSV", direction: "IMPORT", scope: "ASSETS", config: JSON.stringify(config) },
    update: { scope: "ASSETS", config: JSON.stringify(config) },
  });
  try {
    const result = await getConnector("CSV")!.run(source, { trigger: "MANUAL" });
    console.log(result.log);
    console.log(`status=${result.status} created=${result.created} updated=${result.updated} failed=${result.failed}`);
    const imported = await db.asset.findMany({
      where: { syncSourceId: source.id },
      select: { name: true, serial: true, model: true, type: true, status: true },
    });
    console.log("imported assets:", JSON.stringify(imported));
  } finally {
    const del = await db.asset.deleteMany({ where: { syncSourceId: source.id } });
    await db.syncSource.delete({ where: { id: source.id } });
    console.log(`cleaned up ${del.count} asset(s) + source`);
  }
}

async function main() {
  if (has("selftest")) {
    selftest();
    return;
  }

  if (has("csvdemo")) {
    await csvDemo();
    return;
  }

  if (has("assetdemo")) {
    await assetDemo();
    return;
  }

  if (has("list")) {
    const sources = await db.syncSource.findMany({ orderBy: { name: "asc" } });
    if (!sources.length) return console.log("(no sync sources)");
    for (const s of sources) {
      console.log(`- ${s.name}  [${s.type}]  ${s.direction}/${s.scope}  active=${s.isActive}  last=${s.lastStatus ?? "never"}  id=${s.id}`);
    }
    return;
  }

  let source: SyncSource | null = null;
  if (has("demo")) source = await ensureDemoSource();
  else {
    const idOrName = arg("test") ?? arg("run");
    if (!idOrName) {
      console.log("Usage: --list | --test <id|name> | --run <id|name> | --demo");
      return;
    }
    source = await findSource(idOrName);
    if (!source) throw new Error(`Sync source not found: ${idOrName}`);
  }

  const connector = getConnector(source.type);
  if (!connector) throw new Error(`No connector for type "${source.type}".`);

  if (has("test")) {
    console.log(`Testing "${source.name}" …`);
    const res = await connector.test(source);
    console.log(res.ok ? `OK — ${res.message}` : `FAILED — ${res.message}`);
    return;
  }

  // --run or --demo → full run
  console.log(`Running "${source.name}" (${source.type}) …`);
  const result = await connector.run(source, { trigger: "MANUAL" });
  console.log("─".repeat(60));
  console.log(result.log);
  console.log("─".repeat(60));
  console.log(`status=${result.status} created=${result.created} updated=${result.updated} failed=${result.failed}`);
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
