import { describe, expect, it } from "vitest";
import {
  answersToText,
  effectiveApprovalStages,
  parseApprovalStages,
  parseFormSchema,
  serializeApprovalStages,
  validateAnswers,
} from "@/lib/service-forms";

describe("parseFormSchema", () => {
  it("keeps entries with a key + label and drops junk", () => {
    const fields = parseFormSchema(
      JSON.stringify([
        { key: "a", label: "A", type: "text", required: true },
        { label: "no key" },
        "junk",
      ]),
    );
    expect(fields).toHaveLength(1);
    expect(fields[0].key).toBe("a");
  });

  it("returns [] for null/garbage/non-array", () => {
    expect(parseFormSchema(null)).toEqual([]);
    expect(parseFormSchema("{broken")).toEqual([]);
    expect(parseFormSchema('{"not":"an array"}')).toEqual([]);
  });
});

describe("validateAnswers", () => {
  const fields = [
    { key: "why", label: "Why", type: "text" as const, required: true },
    { key: "size", label: "Size", type: "select" as const, options: ["S", "L"] },
    { key: "toxic", label: "Hazardous", type: "checkbox" as const, required: true },
  ];

  it("accepts a complete answer set (answers post as f_<key>)", () => {
    const res = validateAnswers(fields, { f_why: "because", f_size: "S", f_toxic: "true" });
    expect(res.errors).toEqual({});
    expect(res.values).toEqual({ why: "because", size: "S", toxic: true });
  });

  it("rejects missing required answers", () => {
    const res = validateAnswers(fields, { f_size: "S", f_toxic: "on" });
    expect(res.errors.why).toBeTruthy();
  });

  it("rejects a select answer outside the options", () => {
    const res = validateAnswers(fields, { f_why: "x", f_size: "XXL", f_toxic: "true" });
    expect(res.errors.size).toBeTruthy();
  });

  it("caps answer length", () => {
    const res = validateAnswers(fields, { f_why: "x".repeat(6000), f_toxic: "true" });
    expect(res.errors.why).toContain("too long");
  });

  it("checkboxes normalise on/true and flag missing required ones", () => {
    const res = validateAnswers(fields, { f_why: "x", f_size: "S" });
    expect(res.values.toxic).toBe(false);
    expect(res.errors.toxic).toBeTruthy();
  });

  it("numbers must parse", () => {
    const f = [{ key: "n", label: "N", type: "number" as const }];
    expect(validateAnswers(f, { f_n: "42" }).errors).toEqual({});
    expect(validateAnswers(f, { f_n: "abc" }).errors.n).toBeTruthy();
  });
});

describe("answersToText", () => {
  it("renders bullet lines in field order", () => {
    const fields = [
      { key: "a", label: "First", type: "text" as const },
      { key: "b", label: "Second", type: "text" as const },
    ];
    expect(answersToText(fields, { b: "2", a: "1" })).toBe("• First: 1\n• Second: 2");
  });

  it("checkboxes read Yes/No and missing values show a dash", () => {
    const fields = [
      { key: "c", label: "Checked", type: "checkbox" as const },
      { key: "m", label: "Missing", type: "text" as const },
    ];
    expect(answersToText(fields, { c: true })).toBe("• Checked: Yes\n• Missing: —");
  });
});

describe("approval stages", () => {
  it("round-trips serialise → parse with one target per stage", () => {
    const json = serializeApprovalStages([
      { approverId: "u1", groupId: null },
      { approverId: null, groupId: "g1" },
    ])!;
    expect(parseApprovalStages(json)).toEqual([
      { approverId: "u1", groupId: null },
      { approverId: null, groupId: "g1" },
    ]);
  });

  it("serialise returns null for an empty stage list", () => {
    expect(serializeApprovalStages([])).toBeNull();
    expect(serializeApprovalStages([{ approverId: "  ", groupId: "" }])).toBeNull();
  });

  it("parse tolerates garbage and caps the count at 10", () => {
    expect(parseApprovalStages("nope")).toEqual([]);
    expect(parseApprovalStages("[1,2]")).toEqual([]);
    const tooMany = Array.from({ length: 20 }, (_, i) => ({ approverId: `u${i}` }));
    expect(parseApprovalStages(JSON.stringify(tooMany))).toHaveLength(10);
  });

  it("effectiveApprovalStages falls back to the legacy approver", () => {
    expect(effectiveApprovalStages({ approvalStages: null, approverId: "legacy" })).toEqual([
      { approverId: "legacy", groupId: null },
    ]);
    const staged = serializeApprovalStages([{ approverId: "u1", groupId: null }])!;
    expect(effectiveApprovalStages({ approvalStages: staged, approverId: null })).toEqual([
      { approverId: "u1", groupId: null },
    ]);
    expect(effectiveApprovalStages({ approvalStages: null, approverId: null })).toEqual([]);
  });
});
