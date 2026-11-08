import { describe, expect, it } from "vitest";
import {
  FIELD_TYPES,
  answersToText,
  catalogTicketType,
  formUrgency,
  parseMultiValue,
  renderCatalogTitle,
  validateAnswers,
  type ServiceField,
} from "@/lib/service-forms";
import { translateServerMessage } from "@/lib/i18n/translate";
import en from "@/messages/en/catalog";

const fields: ServiceField[] = [
  { key: "software", label: "Software", type: "multiselect", options: ["Office", "CAD, 3D", "Viewer"], required: true },
  { key: "when", label: "Needed at", type: "datetime" },
  { key: "urgency", label: "How urgent?", type: "urgency" },
  { key: "device", label: "Device", type: "asset" },
  { key: "cc", label: "Keep informed", type: "people" },
];

describe("new catalog field types", () => {
  it("are offered with an admin label each", () => {
    for (const type of ["multiselect", "datetime", "urgency", "asset", "people"] as const) {
      expect(FIELD_TYPES).toContain(type);
      expect(en[`fieldType.${type}`]).toBeTruthy();
    }
  });

  it("reads multiple choices from JSON (portal) and from a list (assistant)", () => {
    expect(parseMultiValue('["Office","CAD, 3D","Office"]')).toEqual(["Office", "CAD, 3D"]);
    expect(parseMultiValue("Office, Viewer\nOffice")).toEqual(["Office", "Viewer"]);
    expect(parseMultiValue("")).toEqual([]);
  });

  it("accepts a complete answer set", () => {
    const res = validateAnswers(fields, {
      f_software: '["Office","CAD, 3D"]',
      f_when: "2026-11-20T09:30",
      f_urgency: "HIGH",
      f_device: "asset-1",
      f_cc: "Anna@Example.com, ben@example.com",
    });
    expect(res.errors).toEqual({});
    expect(res.values).toEqual({
      software: ["Office", "CAD, 3D"],
      when: "2026-11-20T09:30",
      urgency: "HIGH",
      device: "asset-1",
      cc: ["anna@example.com", "ben@example.com"],
    });
  });

  it("refuses bad answers", () => {
    const res = validateAnswers(fields, {
      f_software: '["Office","Unknown"]',
      f_when: "tomorrow",
      f_urgency: "CRITICAL",
      f_cc: "not-an-email",
    });
    expect(res.errors).toEqual({
      software: "Invalid selection",
      when: "Enter a date and time",
      urgency: "Invalid selection",
      cc: "Enter email addresses separated by commas",
    });
    expect(validateAnswers(fields, { f_software: "[]" }).errors.software).toBe("This field is required");
    const many = Array.from({ length: 11 }, (_, i) => `p${i}@example.com`).join(",");
    expect(validateAnswers(fields, { f_software: "Office", f_cc: many }).errors.cc).toBe("Add at most 10 people");
  });

  it("translates the new refusals", () => {
    for (const msg of ["Enter a date and time", "Enter email addresses separated by commas", "Add at most 10 people"]) {
      expect(translateServerMessage("de", msg)).not.toBe(msg);
    }
  });

  it("maps the urgency answer and writes readable text", () => {
    const values = { software: ["Office"], when: "2026-11-20T09:30", urgency: "LOW", cc: [] };
    expect(formUrgency(fields, values)).toBe("LOW");
    expect(formUrgency(fields, {})).toBeNull();
    expect(answersToText(fields, values)).toContain("• How urgent?: Low");
    expect(answersToText(fields, values)).toContain("• Needed at: 2026-11-20 09:30");
    expect(answersToText(fields, values)).toContain("• Keep informed: —");
  });
});

describe("catalog ticket type", () => {
  it("is a request unless the item says incident", () => {
    expect(catalogTicketType("INCIDENT")).toBe("INCIDENT");
    expect(catalogTicketType("REQUEST")).toBe("REQUEST");
    expect(catalogTicketType(null)).toBe("REQUEST");
    expect(catalogTicketType("bogus")).toBe("REQUEST");
  });
});

describe("renderCatalogTitle", () => {
  const ctx = { itemName: "New laptop", requesterName: "Max", fields, values: { software: ["Office", "Viewer"], urgency: "HIGH" } };

  it("falls back to '<item> request'", () => {
    expect(renderCatalogTitle(null, ctx)).toBe("New laptop request");
    expect(renderCatalogTitle("  ", ctx)).toBe("New laptop request");
    expect(renderCatalogTitle("{{missing}}", ctx)).toBe("New laptop request");
  });

  it("fills item, requester and answers", () => {
    expect(renderCatalogTitle("{{item}} for {{requester}}: {{software}} ({{ urgency }})", ctx)).toBe(
      "New laptop for Max: Office, Viewer (High)",
    );
  });

  it("drops empty answers and caps the length", () => {
    expect(renderCatalogTitle("{{item}} {{when}} now", ctx)).toBe("New laptop now");
    expect(renderCatalogTitle("x".repeat(300), ctx)).toHaveLength(200);
  });
});
