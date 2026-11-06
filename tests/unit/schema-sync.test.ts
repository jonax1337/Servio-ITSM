import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import {
  OPEN_TICKET_STATUSES,
  PRIORITIES,
  PROBLEM_STATUSES,
  CHANGE_STATUSES,
  TICKET_STATUSES,
  TICKET_TYPES,
  IMPACT_URGENCY,
  ESCALATION_ACTIONS,
  ONCALL_ROTATION_TYPES,
  STATUS_INCIDENT_STATES,
  STATUS_INCIDENT_IMPACTS,
  RELEASE_STATUSES,
  CHANGE_TEMPLATE_TYPES,
  CONTRACT_TYPES,
  CONTRACT_STATUSES,
  LICENSE_TYPES,
  AI_INSIGHT_KINDS,
  AI_INSIGHT_STATUSES,
  MAINTENANCE_KINDS,
  MAINTENANCE_STATUSES,
} from "@/lib/constants";

/**
 * The schema backs its String-typed "enums" with comments only, so comment
 * drift IS the failure mode (a new status that never reaches schema.prisma
 * reads as corrupt data to the next developer). These tests pin every enum
 * comment to lib/constants.ts — the single source of truth.
 */
const schema = readFileSync(
  fileURLToPath(new URL("../../prisma/schema.prisma", import.meta.url)),
  "utf8",
);

/** The `// A | B | C` comment on a `String` column named `field` in `model`. */
function enumComment(model: string, field: string): string {
  const re = new RegExp(`model ${model} \\{[\\s\\S]*?\\n\\s*${field}\\s+String[^/]*// ([^\\n]+)`);
  const m = schema.match(re);
  return m?.[1] ?? "";
}

describe("schema enum comments stay in sync with lib/constants", () => {
  it("Ticket.status documents every TICKET_STATUSES value", () => {
    const comment = enumComment("Ticket", "status");
    for (const s of TICKET_STATUSES) {
      expect(comment, `Ticket.status comment must list ${s}`).toContain(s);
    }
    expect(comment).not.toContain("BOGUS");
  });

  it("Ticket.priority / impact / urgency comments match the enums", () => {
    const prio = enumComment("Ticket", "priority");
    for (const p of PRIORITIES) expect(prio).toContain(p);
    for (const lvl of IMPACT_URGENCY) {
      expect(enumComment("Ticket", "impact")).toContain(lvl);
      expect(enumComment("Ticket", "urgency")).toContain(lvl);
    }
  });

  it("Problem.status and Change.status comments match the enums", () => {
    const problem = enumComment("Problem", "status");
    for (const s of PROBLEM_STATUSES) expect(problem).toContain(s);
    const change = enumComment("Change", "status");
    for (const s of CHANGE_STATUSES) expect(change).toContain(s);
  });

  it("TicketComment.channel documents FORWARD", () => {
    expect(enumComment("TicketComment", "channel")).toContain("FORWARD");
  });

  it("OPEN_TICKET_STATUSES is a subset of TICKET_STATUSES", () => {
    for (const s of OPEN_TICKET_STATUSES) {
      expect(TICKET_STATUSES).toContain(s);
    }
  });

  it("ticket type prefixes stay unique (ref numbers depend on them)", () => {
    // prefixForType is derived in constants; verify via the exported types that
    // the list itself carries no duplicates.
    expect(new Set(TICKET_TYPES).size).toBe(TICKET_TYPES.length);
    expect(new Set(TICKET_STATUSES).size).toBe(TICKET_STATUSES.length);
    expect(new Set(PRIORITIES).size).toBe(PRIORITIES.length);
  });
});

describe("ITSM ops / Sable enum comments stay in sync with lib/constants", () => {
  const cases: Array<[model: string, field: string, values: readonly string[]]> = [
    ["EscalationStep", "action", ESCALATION_ACTIONS],
    ["OnCallSchedule", "rotationType", ONCALL_ROTATION_TYPES],
    ["StatusIncident", "state", STATUS_INCIDENT_STATES],
    ["StatusIncident", "impact", STATUS_INCIDENT_IMPACTS],
    ["StatusIncidentUpdate", "state", STATUS_INCIDENT_STATES],
    ["Release", "status", RELEASE_STATUSES],
    ["ChangeTemplate", "type", CHANGE_TEMPLATE_TYPES],
    ["Contract", "type", CONTRACT_TYPES],
    ["Contract", "status", CONTRACT_STATUSES],
    ["SoftwareLicense", "licenseType", LICENSE_TYPES],
    ["AiInsight", "kind", AI_INSIGHT_KINDS],
    ["AiInsight", "status", AI_INSIGHT_STATUSES],
    ["MaintenanceWindow", "kind", MAINTENANCE_KINDS],
    ["MaintenanceWindow", "status", MAINTENANCE_STATUSES],
  ];

  it.each(cases)("%s.%s documents every allowed value", (model, field, values) => {
    const comment = enumComment(model, field);
    for (const v of values) expect(comment, `${model}.${field} comment must list ${v}`).toContain(v);
  });
});

describe("schema column types hold the values the app writes", () => {
  // Prisma `Int` is 32-bit: millisecond durations overflow it after ~24.8 days.
  // SQLite still stores the oversized value, and every later read of that row
  // throws "Value … does not fit in an INT column" — one ticket breaks a list.
  it("no millisecond column is a 32-bit Int", () => {
    const msIntColumns = [...schema.matchAll(/^\s*(\w+Ms)\s+Int\b/gm)].map((m) => m[1]);
    expect(msIntColumns, "use Float for ms columns (exact up to 2^53, stays a JS number)").toEqual([]);
  });

  it("no byte-size column is a 32-bit Int", () => {
    // Int caps at 2 GiB − 1 byte; the upload cap (MAX_UPLOAD_MB) is admin-settable.
    const byteIntColumns = [...schema.matchAll(/^\s*(size|\w+Bytes)\s+Int\b/gm)].map((m) => m[1]);
    expect(byteIntColumns, "use Float for byte sizes (exact up to 2^53, stays a JS number)").toEqual([]);
  });

  it.each([
    ["Ticket", "pausedMs"],
    ["Attachment", "size"],
  ])("%s.%s is a Float", (model, field) => {
    expect(schema).toMatch(new RegExp(`model ${model} \\{[\\s\\S]*?\\n\\s*${field}\\s+Float\\b`));
  });
});
