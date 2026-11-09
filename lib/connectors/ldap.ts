import { Client } from "ldapts";
import { z } from "zod";
import type { Entry } from "ldapts";
import type { SyncSource } from "@prisma/client";
import { decryptSecret } from "@/lib/crypto";
import type { Connector, ConnectorTestResult, SyncResult } from "./types";
import { SyncLog } from "./types";
import { importUsers, errMessage, type ImportError, type ImportUser } from "./import";
import { binaryExternalId, isBinaryAttr } from "./ldap-identifiers";

/**
 * LDAP / Active Directory user import. Binds with a service account, pages
 * through the directory and hands the mapped users to the shared importer
 * (upsert by (syncSourceId, externalId), email fallback, optional deactivate).
 * The bind password lives in `SyncSource.config` as an AES-GCM blob and is
 * decrypted only here, at run time.
 */

export const ldapConfigSchema = z.object({
  url: z.string().min(1),
  baseDN: z.string().min(1),
  bindDN: z.string().min(1),
  bindPassword: z.string().optional().default(""),
  userFilter: z.string().min(1),
  searchScope: z.enum(["sub", "one"]).optional().default("sub"),
  pageSize: z.coerce.number().int().positive().max(5000).optional().default(500),
  tlsRejectUnauthorized: z.coerce.boolean().optional().default(true),
  deactivateMissing: z.coerce.boolean().optional().default(false),
  externalId: z.string().optional().default(""),
  email: z.string().optional().default(""),
  name: z.string().optional().default(""),
  jobTitle: z.string().optional().default(""),
  phone: z.string().optional().default(""),
  department: z.string().optional().default(""),
});

export type LdapConfig = z.infer<typeof ldapConfigSchema>;
type AttrMap = Pick<LdapConfig, "externalId" | "email" | "name" | "jobTitle" | "phone" | "department">;

/** The first value of an LDAP attribute. */
function firstValue(value: Entry[string] | undefined): Buffer | string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** Normalise an LDAP attribute value to a single string (hex for binary). */
function first(value: Entry[string] | undefined): string {
  const v = firstValue(value);
  if (v == null) return "";
  if (Buffer.isBuffer(v)) return v.toString("hex");
  return String(v);
}

/**
 * The external id of an entry. A binary objectGUID / objectSid becomes its
 * canonical text form (see ldap-identifiers.ts); the hex an earlier release
 * stored is passed along so those users are still recognised.
 */
function externalIdOf(entry: Entry, attribute: string): Pick<ImportUser, "externalId" | "legacyExternalIds"> {
  const value = firstValue(entry[attribute]);
  if (!Buffer.isBuffer(value)) return { externalId: first(entry[attribute]) };
  const { externalId, legacy } = binaryExternalId(attribute, value);
  return legacy.length > 0 ? { externalId, legacyExternalIds: legacy } : { externalId };
}

/**
 * Map one directory entry to an ImportUser. Directory is source of truth:
 * mapped-but-empty attributes clear the field (null); unmapped attributes
 * (blank mapping) are left untouched. Pure — unit-testable without a server.
 */
export function mapEntry(entry: Entry, map: AttrMap): ImportUser | ImportError {
  const id = externalIdOf(entry, map.externalId);
  const email = first(entry[map.email]).toLowerCase().trim();
  if (!id.externalId || !email)
    return { error: `missing ${!id.externalId ? "external id" : "email"}`, ref: entry.dn };

  const user: ImportUser = { ...id, email, name: first(entry[map.name]).trim() || null };
  if (map.jobTitle) user.jobTitle = first(entry[map.jobTitle]).trim() || null;
  if (map.phone) user.phone = first(entry[map.phone]).trim() || null;
  if (map.department) user.department = first(entry[map.department]).trim() || null;
  return user;
}

function loadConfig(source: SyncSource): LdapConfig {
  const raw = JSON.parse(source.config || "{}") as unknown;
  const cfg = ldapConfigSchema.parse(raw);
  if (cfg.bindPassword) cfg.bindPassword = decryptSecret(cfg.bindPassword) ?? "";
  return cfg;
}

function makeClient(cfg: LdapConfig): Client {
  return new Client({
    url: cfg.url,
    tlsOptions: { rejectUnauthorized: cfg.tlsRejectUnauthorized },
    timeout: 30_000,
    connectTimeout: 15_000,
  });
}

function attrList(cfg: AttrMap): string[] {
  return Array.from(
    new Set(
      [cfg.externalId, cfg.email, cfg.name, cfg.jobTitle, cfg.phone, cfg.department].filter(
        (a): a is string => !!a,
      ),
    ),
  );
}

async function testConnection(source: SyncSource): Promise<ConnectorTestResult> {
  let cfg: LdapConfig;
  try {
    cfg = loadConfig(source);
  } catch (e) {
    return { ok: false, message: `Invalid configuration: ${errMessage(e)}` };
  }
  const client = makeClient(cfg);
  try {
    await client.bind(cfg.bindDN, cfg.bindPassword);
    const { searchEntries } = await client.search(cfg.baseDN, {
      scope: cfg.searchScope,
      filter: cfg.userFilter,
      sizeLimit: 1,
      paged: false,
      attributes: [cfg.email],
    });
    return {
      ok: true,
      message: `Bound as ${cfg.bindDN}; base DN is searchable (matched ${searchEntries.length} sample entry).`,
    };
  } catch (e) {
    const m = errMessage(e);
    if (/size limit/i.test(m))
      return { ok: true, message: "Bound and searched successfully (size limit reached — expected)." };
    return { ok: false, message: m };
  } finally {
    try {
      await client.unbind();
    } catch {
      /* ignore */
    }
  }
}

async function run(source: SyncSource): Promise<SyncResult> {
  const log = new SyncLog();

  let cfg: LdapConfig;
  try {
    cfg = loadConfig(source);
  } catch (e) {
    log.line(`Invalid configuration: ${errMessage(e)}`);
    log.failed = 1;
    return { status: "FAILED", created: 0, updated: 0, failed: 1, log: log.toString() };
  }

  const client = makeClient(cfg);
  try {
    await client.bind(cfg.bindDN, cfg.bindPassword);
    log.line(`Bound as ${cfg.bindDN}. Searching ${cfg.baseDN} (${cfg.searchScope}) …`);

    const { searchEntries } = await client.search(cfg.baseDN, {
      scope: cfg.searchScope,
      filter: cfg.userFilter,
      paged: { pageSize: cfg.pageSize },
      attributes: attrList(cfg),
      explicitBufferAttributes: isBinaryAttr(cfg.externalId) ? [cfg.externalId] : [],
    });
    log.line(`Directory returned ${searchEntries.length} entries.`);

    const records = searchEntries.map((e) => mapEntry(e, cfg));
    await importUsers(source, records, cfg.deactivateMissing, log);
  } catch (e) {
    log.line(`Sync error: ${errMessage(e)}`);
    if (log.created === 0 && log.updated === 0) {
      log.failed = Math.max(log.failed, 1);
      return {
        status: "FAILED",
        created: log.created,
        updated: log.updated,
        failed: log.failed,
        log: log.toString(),
      };
    }
  } finally {
    try {
      await client.unbind();
    } catch {
      /* ignore */
    }
  }

  return log.result();
}

export const ldapConnector: Connector = { test: testConnection, run };
