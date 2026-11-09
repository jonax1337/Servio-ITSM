import { describe, expect, it } from "vitest";
import {
  answersToText,
  conditionTokens,
  formSchemaProblems,
  parseFormSchema,
  renderCatalogTitle,
  validateAnswers,
  visibleFields,
  type ServiceField,
} from "@/lib/service-forms";
import { translateServerMessage } from "@/lib/i18n/translate";

// "Hardware or software?" branches into different follow-ups; a checkbox and an
// urgency question each gate one more question, and `serial` chains on `model`.
const form: ServiceField[] = [
  { key: "kind", label: "Hardware or software?", type: "select", options: ["Hardware", "Software"], required: true },
  { key: "model", label: "Model", type: "select", options: ["Laptop", "Desktop"], required: true, condition: { field: "kind", values: ["Hardware"] } },
  { key: "serial", label: "Old serial", type: "text", required: true, condition: { field: "model", values: ["Laptop"] } },
  { key: "apps", label: "Which apps?", type: "multiselect", options: ["Office", "CAD"], required: true, condition: { field: "kind", values: ["Software"] } },
  { key: "cad_seat", label: "CAD seat number", type: "text", required: true, condition: { field: "apps", values: ["CAD"] } },
  { key: "remote", label: "Working remotely", type: "checkbox" },
  { key: "address", label: "Delivery address", type: "textarea", required: true, condition: { field: "remote", values: ["true"] } },
  { key: "urgency", label: "How urgent?", type: "urgency" },
  { key: "why_now", label: "Why so urgent?", type: "text", required: true, condition: { field: "urgency", values: ["HIGH"] } },
];
const keys = (fields: ServiceField[]) => fields.map((f) => f.key);

describe("visibleFields", () => {
  it("shows only the unconditional questions before anything is answered", () => {
    expect(keys(visibleFields(form, {}))).toEqual(["kind", "remote", "urgency"]);
  });

  it("follows a select, a multiple choice, a checkbox and an urgency answer", () => {
    expect(keys(visibleFields(form, { kind: "Software", apps: '["Office","CAD"]', remote: "on", urgency: "HIGH" }))).toEqual([
      "kind", "apps", "cad_seat", "remote", "address", "urgency", "why_now",
    ]);
  });

  it("collapses a chain when the first answer changes", () => {
    const answers = { kind: "Hardware", model: "Laptop" };
    expect(keys(visibleFields(form, answers))).toContain("serial");
    expect(keys(visibleFields(form, { ...answers, kind: "Software" }))).not.toContain("serial");
  });

  it("evaluates stored answers too (booleans and arrays)", () => {
    expect(keys(visibleFields(form, { kind: "Software", apps: ["CAD"], remote: true }))).toEqual(["kind", "apps", "cad_seat", "remote", "address", "urgency"]);
    expect(keys(visibleFields(form, { remote: false }))).not.toContain("address");
  });

  it("can show a question for an unticked checkbox", () => {
    const fields: ServiceField[] = [
      { key: "own", label: "I have a device", type: "checkbox" },
      { key: "which", label: "Which device do you need?", type: "text", condition: { field: "own", values: ["false"] } },
    ];
    expect(keys(visibleFields(fields, {}))).toEqual(["own", "which"]);
    expect(keys(visibleFields(fields, { own: "on" }))).toEqual(["own"]);
  });

  it("ignores a malformed condition instead of hiding the question for good", () => {
    const fields: ServiceField[] = [
      { key: "a", label: "A", type: "text" },
      { key: "b", label: "B", type: "text", condition: { field: "a", values: ["x"] } },
      { key: "c", label: "C", type: "text", condition: { field: "later", values: ["x"] } },
      { key: "later", label: "Later", type: "select", options: ["x"] },
    ];
    expect(keys(visibleFields(fields, {}))).toEqual(["a", "b", "c", "later"]);
  });
});

describe("conditionTokens", () => {
  it("reads raw and stored answers", () => {
    expect(conditionTokens(form[0], " Hardware ")).toEqual(["Hardware"]);
    expect(conditionTokens(form[0], "")).toEqual([]);
    expect(conditionTokens(form[3], "Office, CAD")).toEqual(["Office", "CAD"]);
    expect(conditionTokens(form[3], ["CAD"])).toEqual(["CAD"]);
    expect(conditionTokens(form[5], "on")).toEqual(["true"]);
    expect(conditionTokens(form[5], undefined)).toEqual(["false"]);
  });
});

describe("validateAnswers with conditions", () => {
  it("requires a conditional question only while it is shown", () => {
    expect(validateAnswers(form, { f_kind: "Software", f_apps: '["Office"]' }).errors).toEqual({});
    expect(validateAnswers(form, { f_kind: "Hardware" }).errors).toEqual({ model: "This field is required" });
    expect(validateAnswers(form, { f_kind: "Hardware", f_model: "Laptop" }).errors).toEqual({ serial: "This field is required" });
    expect(validateAnswers(form, { f_kind: "Software", f_apps: "[]", f_remote: "on", f_urgency: "HIGH" }).errors).toEqual({
      apps: "This field is required",
      address: "This field is required",
      why_now: "This field is required",
    });
  });

  it("does not store answers to hidden questions, even when they were posted", () => {
    const { values, errors } = validateAnswers(form, {
      f_kind: "Software",
      f_apps: '["Office"]',
      f_model: "Laptop",
      f_serial: "SN-1",
      f_cad_seat: "42",
      f_address: "Somewhere 1",
    });
    expect(errors).toEqual({});
    expect(values).toEqual({ kind: "Software", apps: ["Office"], remote: false, urgency: "" });
  });

  it("leaves hidden questions out of the ticket text and title", () => {
    const { values } = validateAnswers(form, { f_kind: "Software", f_apps: '["CAD"]', f_cad_seat: "7", f_serial: "SN-1" });
    const text = answersToText(form, values);
    expect(text).toContain("• CAD seat number: 7");
    expect(text).not.toContain("Model");
    expect(text).not.toContain("Old serial");
    expect(
      renderCatalogTitle("{{kind}} {{serial}} {{cad_seat}}", { itemName: "Order", requesterName: "Ann", fields: form, values }),
    ).toBe("Software 7");
  });
});

describe("formSchemaProblems", () => {
  it("accepts the branching form", () => {
    expect(formSchemaProblems(form)).toEqual([]);
  });

  it("names every problem by its position", () => {
    const fields: ServiceField[] = [
      { key: "a", label: "A", type: "select", options: [] },
      { key: "b", label: "B", type: "text", condition: { field: "c", values: ["x"] } },
      { key: "c", label: "C", type: "text" },
      { key: "d", label: "D", type: "text", condition: { field: "c", values: ["x"] } },
      { key: "e", label: "E", type: "select", options: ["x"], condition: { field: "a", values: [] } },
      { key: "f", label: "F", type: "checkbox" },
      { key: "g", label: "G", type: "text", condition: { field: "f", values: ["yes"] } },
      { key: "g", label: "G again", type: "text" },
    ];
    expect(formSchemaProblems(fields)).toEqual([
      "Question 1: add at least one option.",
      "Question 2: the condition must refer to an earlier question.",
      "Question 4: only a choice, multiple choice, checkbox or urgency question can show or hide another question.",
      "Question 5: choose at least one answer that shows the question.",
      "Question 7: the condition names an answer the earlier question does not offer.",
      "Question 8: another question already uses this key.",
    ]);
  });

  it("translates every problem into German", () => {
    const messages = [
      "Question 1: add at least one option.",
      "Question 2: the condition must refer to an earlier question.",
      "Question 4: only a choice, multiple choice, checkbox or urgency question can show or hide another question.",
      "Question 5: choose at least one answer that shows the question.",
      "Question 7: the condition names an answer the earlier question does not offer.",
      "Question 8: another question already uses this key.",
      "A form can have at most 100 questions.",
      "Every question needs a label",
      "Question keys are 1-100 characters: letters, digits, _ or -",
    ];
    for (const m of messages) expect(translateServerMessage("de", m)).not.toBe(m);
  });
});

describe("parseFormSchema conditions", () => {
  it("keeps a well-formed condition and drops a malformed one", () => {
    const fields = parseFormSchema(
      JSON.stringify([
        { key: "a", label: "A", type: "checkbox" },
        { key: "b", label: "B", type: "text", condition: { field: "a", values: ["true", 3] } },
        { key: "c", label: "C", type: "text", condition: "a=true" },
        { key: "d", label: "D", type: "text", condition: null },
      ]),
    );
    expect(fields[1].condition).toEqual({ field: "a", values: ["true"] });
    expect("condition" in fields[2]).toBe(false);
    expect("condition" in fields[3]).toBe(false);
  });
});
