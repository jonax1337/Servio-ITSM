import { formatMappingLines, type GroupMapping } from "./group-mapping";

/**
 * Declarative, per-connector form metadata. PURE data — no server imports — so
 * both the client config form (components/syncs/source-form.tsx) and the server
 * pages/actions can share it. Form field `name` === flat config key, which keeps
 * form <-> config conversion fully generic (see configToFormValues + the action's
 * buildConfig). Adding a connector = add a ConnectorSpec here + a Connector impl.
 *
 * A connector can support one or more scopes (USERS / ASSETS). Base fields are
 * shared across scopes; the mapping section is scope-specific.
 */

export type FieldType = "text" | "password" | "number" | "switch" | "select" | "textarea";

export type FieldSpec = {
  name: string;
  label: string;
  type?: FieldType;
  section: string;
  options?: { value: string; label: string }[];
  placeholder?: string;
  hint?: string;
  mono?: boolean;
  /** only render when another field currently equals this value */
  showWhen?: { field: string; equals: string | boolean };
};

export type ConnectorSpec = {
  type: string;
  label: string;
  blurb: string;
  /** which import scopes this connector supports, in display order */
  scopes: string[];
  /** connection/source/options fields, shared across scopes */
  baseFields: FieldSpec[];
  /** scope -> field-mapping fields */
  mapping: Record<string, FieldSpec[]>;
  defaults: Record<string, string | number | boolean>;
  secretFields: string[];
  configurable: boolean;
};

const MAPPING_SECTION = "Field mapping";

function map(name: string, label: string, hint?: string): FieldSpec {
  return { name, label, section: MAPPING_SECTION, mono: true, hint };
}

function userMapping(): FieldSpec[] {
  return [
    map("externalId", "External ID"),
    map("email", "Email"),
    map("name", "Full name"),
    map("jobTitle", "Job title"),
    map("phone", "Phone"),
    map("department", "Department"),
  ];
}

function assetMapping(): FieldSpec[] {
  return [
    map("externalId", "External ID"),
    map("name", "Name"),
    map("assetTag", "Asset tag"),
    map("serial", "Serial"),
    map("model", "Model"),
    map("manufacturer", "Manufacturer"),
    map("type", "Type"),
    map("status", "Status"),
    map("ipAddress", "IP address"),
    map("macAddress", "MAC address"),
    map("os", "OS"),
    map("location", "Location"),
  ];
}

const deactivateField: FieldSpec = {
  name: "deactivateMissing",
  label: "Reconcile records removed from the source",
  type: "switch",
  section: "Options",
  hint: "Users → deactivated (isActive=false); assets → retired (status=RETIRED). Never deletes — history is kept.",
};

/** Default column/attribute/field names shared by CSV & REST (users + assets). */
const GENERIC_MAP_DEFAULTS = {
  externalId: "id",
  email: "email",
  name: "name",
  jobTitle: "title",
  phone: "phone",
  department: "department",
  assetTag: "asset_tag",
  serial: "serial",
  model: "model",
  manufacturer: "manufacturer",
  type: "type",
  status: "status",
  ipAddress: "ip_address",
  macAddress: "mac_address",
  os: "os",
  location: "location",
} as const;

const LDAP: ConnectorSpec = {
  type: "LDAP",
  label: "LDAP",
  blurb: "Bind to an LDAP directory and import users.",
  scopes: ["USERS"],
  baseFields: [
    { name: "url", label: "Server URL", section: "Connection", mono: true, placeholder: "ldap://ldap.example.com:389" },
    { name: "bindDN", label: "Bind DN", section: "Connection", mono: true, placeholder: "cn=admin,dc=example,dc=com" },
    { name: "bindPassword", label: "Bind password", type: "password", section: "Connection" },
    { name: "tlsRejectUnauthorized", label: "Verify TLS certificate", type: "switch", section: "Connection" },
    { name: "baseDN", label: "Base DN", section: "Directory", mono: true, placeholder: "ou=people,dc=example,dc=com" },
    { name: "userFilter", label: "User filter", section: "Directory", mono: true },
    {
      name: "searchScope",
      label: "Search scope",
      type: "select",
      section: "Directory",
      options: [
        { value: "sub", label: "Subtree (all descendants)" },
        { value: "one", label: "One level (direct children)" },
      ],
    },
    { name: "pageSize", label: "Page size", type: "number", section: "Directory", placeholder: "500" },
    deactivateField,
    {
      name: "groupMappings",
      label: "Group mappings",
      type: "textarea",
      section: "Group membership",
      mono: true,
      placeholder: "CN=IT-Support,OU=Groups,DC=corp,DC=local => service-desk\nNetwork Team => cl_group_id",
      hint:
        "Optional. One mapping per line: <directory group DN or name> => <Servio group id or import ref>. On every run the Servio group membership of the users this source imported follows the directory group; members added by hand who are not imported from this source are left alone.",
    },
    {
      name: "groupBaseDN",
      label: "Group search base",
      section: "Group membership",
      mono: true,
      placeholder: "ou=groups,dc=example,dc=com",
      hint: "Where a directory group given by name is looked up. Blank = the base DN above.",
    },
    {
      name: "groupNested",
      label: "Include nested groups",
      type: "switch",
      section: "Group membership",
      hint: "Also count members of groups nested in a mapped group. Active Directory only (matching rule in chain).",
    },
  ],
  mapping: { USERS: userMapping() },
  defaults: {
    url: "ldap://ldap.example.com:389",
    bindDN: "cn=admin,dc=example,dc=com",
    tlsRejectUnauthorized: true,
    baseDN: "ou=people,dc=example,dc=com",
    userFilter: "(objectClass=inetOrgPerson)",
    searchScope: "sub",
    pageSize: 500,
    externalId: "entryUUID",
    email: "mail",
    name: "cn",
    jobTitle: "title",
    phone: "telephoneNumber",
    department: "ou",
    deactivateMissing: false,
    groupMappings: "",
    groupBaseDN: "",
    groupNested: false,
  },
  secretFields: ["bindPassword"],
  configurable: true,
};

const ACTIVE_DIRECTORY: ConnectorSpec = {
  ...LDAP,
  type: "ACTIVE_DIRECTORY",
  label: "Active Directory",
  blurb: "Bind to Active Directory (LDAP) and import users.",
  defaults: {
    url: "ldaps://dc01.corp.local:636",
    bindDN: "CN=svc-servio,OU=Service Accounts,DC=corp,DC=local",
    tlsRejectUnauthorized: true,
    baseDN: "DC=corp,DC=local",
    userFilter:
      "(&(objectCategory=person)(objectClass=user)(!(userAccountControl:1.2.840.113556.1.4.803:=2)))",
    searchScope: "sub",
    pageSize: 500,
    externalId: "objectGUID",
    email: "mail",
    name: "displayName",
    jobTitle: "title",
    phone: "telephoneNumber",
    department: "department",
    deactivateMissing: false,
    groupMappings: "",
    groupBaseDN: "",
    groupNested: false,
  },
};

const AZURE_AD: ConnectorSpec = {
  type: "AZURE_AD",
  label: "Azure AD / Entra",
  blurb: "Import users from Microsoft Entra ID via the Graph API (app registration with Users.Read.All).",
  scopes: ["USERS"],
  baseFields: [
    { name: "tenantId", label: "Tenant ID", section: "Connection", mono: true, placeholder: "contoso.onmicrosoft.com or a GUID" },
    { name: "clientId", label: "Client ID", section: "Connection", mono: true },
    { name: "clientSecret", label: "Client secret", type: "password", section: "Connection" },
    {
      name: "filter",
      label: "Graph $filter (optional)",
      section: "Directory",
      mono: true,
      placeholder: "accountEnabled eq true",
      hint: "OData filter applied to /users. Leave blank for all users. Mapping is fixed to standard Graph fields.",
    },
    deactivateField,
  ],
  mapping: { USERS: [] },
  defaults: { tenantId: "", clientId: "", filter: "", deactivateMissing: false },
  secretFields: ["clientSecret"],
  configurable: true,
};

const CSV: ConnectorSpec = {
  type: "CSV",
  label: "CSV Import",
  blurb: "Import users or assets from a CSV file — fetched from a URL or pasted inline.",
  scopes: ["USERS", "ASSETS"],
  baseFields: [
    {
      name: "mode",
      label: "Source",
      type: "select",
      section: "Source",
      options: [
        { value: "url", label: "Fetch from URL" },
        { value: "inline", label: "Paste CSV" },
      ],
    },
    { name: "url", label: "CSV URL", section: "Source", mono: true, placeholder: "https://…/records.csv", showWhen: { field: "mode", equals: "url" } },
    { name: "data", label: "CSV data", type: "textarea", section: "Source", mono: true, showWhen: { field: "mode", equals: "inline" }, placeholder: "id,email,name\n1,a@x.com,Alice" },
    { name: "delimiter", label: "Delimiter", section: "Source", mono: true, placeholder: "," },
    { name: "hasHeader", label: "First row is a header", type: "switch", section: "Source" },
    deactivateField,
  ],
  mapping: {
    USERS: userMapping().map((f) => ({ ...f, hint: "Column header name, or a 0-based index if there is no header." })),
    ASSETS: assetMapping().map((f) => ({ ...f, hint: "Column header name, or a 0-based index if there is no header." })),
  },
  defaults: {
    mode: "url",
    url: "",
    data: "",
    delimiter: ",",
    hasHeader: true,
    deactivateMissing: false,
    ...GENERIC_MAP_DEFAULTS,
  },
  secretFields: [],
  configurable: true,
};

const REST_API: ConnectorSpec = {
  type: "REST_API",
  label: "REST API",
  blurb:
    "Import users or assets from any JSON HTTP endpoint returning an array of records. Works with NetBox and similar tools (scope=Assets, records path 'results', next path 'next', Authorization 'Token …').",
  scopes: ["USERS", "ASSETS"],
  baseFields: [
    { name: "url", label: "Endpoint URL", section: "Connection", mono: true, placeholder: "https://netbox.example.com/api/dcim/devices/?limit=100" },
    {
      name: "method",
      label: "Method",
      type: "select",
      section: "Connection",
      options: [
        { value: "GET", label: "GET" },
        { value: "POST", label: "POST" },
      ],
    },
    { name: "authHeader", label: "Authorization header", type: "password", section: "Connection", placeholder: "Token … / Bearer …" },
    { name: "headers", label: "Extra headers (JSON)", type: "textarea", section: "Connection", mono: true, placeholder: '{"Accept":"application/json"}' },
    {
      name: "recordsPath",
      label: "Records path",
      section: "Data",
      mono: true,
      placeholder: "results",
      hint: "Dot path to the array in the response. Blank if the response is already an array. NetBox: results.",
    },
    {
      name: "nextPath",
      label: "Next-page path",
      section: "Data",
      mono: true,
      placeholder: "next",
      hint: "Dot path to a next-page URL for pagination. Blank to disable. NetBox: next.",
    },
    deactivateField,
  ],
  mapping: {
    USERS: userMapping().map((f) => ({ ...f, hint: "Dot path within each record (e.g. profile.email)." })),
    ASSETS: assetMapping().map((f) => ({ ...f, hint: "Dot path within each record (e.g. device_type.model)." })),
  },
  defaults: {
    url: "",
    method: "GET",
    authHeader: "",
    headers: "",
    recordsPath: "",
    nextPath: "",
    deactivateMissing: false,
    ...GENERIC_MAP_DEFAULTS,
  },
  secretFields: ["authHeader"],
  configurable: true,
};

export const CONNECTOR_SPECS: Record<string, ConnectorSpec> = {
  ACTIVE_DIRECTORY,
  LDAP,
  AZURE_AD,
  CSV,
  REST_API,
};

/** Types offered in the create form's picker, in display order. */
export const CONFIGURABLE_TYPES: ConnectorSpec[] = [
  ACTIVE_DIRECTORY,
  LDAP,
  AZURE_AD,
  CSV,
  REST_API,
].filter((s) => s.configurable);

export const SCOPE_LABELS: Record<string, string> = {
  USERS: "Users",
  ASSETS: "Assets",
};

export function getSpec(type: string): ConnectorSpec | null {
  return CONNECTOR_SPECS[type] ?? null;
}

/** Resolve the effective field list for a (type, scope): base + scope mapping. */
export function fieldsFor(spec: ConnectorSpec, scope: string): FieldSpec[] {
  const mapping = spec.mapping[scope] ?? spec.mapping[spec.scopes[0]] ?? [];
  return [...spec.baseFields, ...mapping];
}

/** Distinct sections for a field list, in first-appearance order. */
export function sectionsOf(fields: FieldSpec[]): string[] {
  const out: string[] = [];
  for (const f of fields) if (!out.includes(f.section)) out.push(f.section);
  return out;
}

/**
 * Flatten a stored config into form values for the edit form. Secrets are never
 * exposed; `passwordSet` reports whether one is stored. Missing keys fall back
 * to the type's defaults so partial/old configs degrade gracefully.
 */
export function configToFormValues(
  type: string,
  scope: string,
  configRaw: string,
): { values: Record<string, string | number | boolean>; passwordSet: boolean } {
  const spec = getSpec(type);
  if (!spec) return { values: {}, passwordSet: false };
  let obj: Record<string, unknown> = {};
  try {
    obj = (JSON.parse(configRaw || "{}") as Record<string, unknown>) ?? {};
  } catch {
    obj = {};
  }
  const values: Record<string, string | number | boolean> = {};
  for (const f of fieldsFor(spec, scope)) {
    if (spec.secretFields.includes(f.name)) continue;
    const v = obj[f.name];
    if (f.name === "groupMappings" && Array.isArray(v)) {
      // Stored as a list of mappings, edited as one line per mapping.
      values[f.name] = formatMappingLines(v as GroupMapping[]);
      continue;
    }
    values[f.name] =
      v === undefined || v === null
        ? spec.defaults[f.name] ?? (f.type === "switch" ? false : "")
        : (v as string | number | boolean);
  }
  const passwordSet = spec.secretFields.some(
    (k) => typeof obj[k] === "string" && (obj[k] as string).length > 0,
  );
  return { values, passwordSet };
}
