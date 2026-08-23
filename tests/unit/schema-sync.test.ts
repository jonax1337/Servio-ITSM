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
