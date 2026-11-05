import { describe, expect, it } from "vitest";
import {
  KNOWN_ERROR_NEEDS_WORKAROUND,
  PROBLEM_LOCKED_MESSAGE,
  RESOLVED_NEEDS_ROOT_CAUSE,
  fieldLockError,
  isProblemLocked,
  resolvedAtPatch,
  statusRequirementError,
  textEditError,
} from "@/lib/problem-rules";
import { PROBLEM_STATUSES } from "@/lib/constants";

const documented = { rootCause: "Memory leak in the cache layer", workaround: "Restart the service nightly" };
const undocumented = { rootCause: null, workaround: null };

describe("statusRequirementError", () => {
  it("requires a workaround for a known error", () => {
    expect(statusRequirementError("KNOWN_ERROR", { ...documented, workaround: null })).toBe(KNOWN_ERROR_NEEDS_WORKAROUND);
    expect(statusRequirementError("KNOWN_ERROR", documented)).toBeNull();
  });

  it("requires a root cause for a resolved problem", () => {
    expect(statusRequirementError("RESOLVED", { ...documented, rootCause: null })).toBe(RESOLVED_NEEDS_ROOT_CAUSE);
    expect(statusRequirementError("RESOLVED", documented)).toBeNull();
  });

  it("treats empty and whitespace-only text as missing", () => {
    expect(statusRequirementError("KNOWN_ERROR", { ...documented, workaround: "" })).toBe(KNOWN_ERROR_NEEDS_WORKAROUND);
    expect(statusRequirementError("KNOWN_ERROR", { ...documented, workaround: "  \n " })).toBe(KNOWN_ERROR_NEEDS_WORKAROUND);
    expect(statusRequirementError("RESOLVED", { ...documented, rootCause: " \t" })).toBe(RESOLVED_NEEDS_ROOT_CAUSE);
  });

  it("asks a known error for the workaround only, and a resolved problem for the root cause only", () => {
    expect(statusRequirementError("KNOWN_ERROR", { rootCause: null, workaround: "Restart" })).toBeNull();
    expect(statusRequirementError("RESOLVED", { rootCause: "Leak", workaround: null })).toBeNull();
  });

  it("asks nothing of the other statuses", () => {
    for (const status of ["NEW", "INVESTIGATING", "CLOSED"]) {
      expect(statusRequirementError(status, undocumented), status).toBeNull();
    }
  });
});

describe("closed problem lock", () => {
  it("locks only CLOSED", () => {
    expect(PROBLEM_STATUSES.filter(isProblemLocked)).toEqual(["CLOSED"]);
  });

  it("refuses the descriptive fields of a closed problem", () => {
    for (const field of ["title", "description", "rootCause", "workaround", "priority", "impact", "categoryId"]) {
      expect(fieldLockError("CLOSED", field), field).toBe(PROBLEM_LOCKED_MESSAGE);
    }
  });

  it("keeps status, assignment and group editable on a closed problem", () => {
    for (const field of ["status", "assigneeId", "groupId"]) {
      expect(fieldLockError("CLOSED", field), field).toBeNull();
    }
  });

  it("allows every field once the problem is reopened or still active", () => {
    for (const status of PROBLEM_STATUSES.filter((s) => s !== "CLOSED")) {
      expect(fieldLockError(status, "title"), status).toBeNull();
      expect(fieldLockError(status, "priority"), status).toBeNull();
    }
  });
});

describe("textEditError", () => {
  it("refuses blanking the workaround of a known error and the root cause of a resolved problem", () => {
    expect(textEditError("KNOWN_ERROR", "workaround", null)).toBe(KNOWN_ERROR_NEEDS_WORKAROUND);
    expect(textEditError("KNOWN_ERROR", "workaround", "  ")).toBe(KNOWN_ERROR_NEEDS_WORKAROUND);
    expect(textEditError("RESOLVED", "rootCause", null)).toBe(RESOLVED_NEEDS_ROOT_CAUSE);
  });

  it("allows filling in or amending the required text", () => {
    expect(textEditError("KNOWN_ERROR", "workaround", "Restart")).toBeNull();
    expect(textEditError("RESOLVED", "rootCause", "Leak")).toBeNull();
  });

  it("lets a legacy problem document the field its status does not depend on", () => {
    expect(textEditError("KNOWN_ERROR", "rootCause", "Leak")).toBeNull();
    expect(textEditError("RESOLVED", "workaround", "Restart")).toBeNull();
  });

  it("allows clearing either text in statuses that require neither", () => {
    for (const status of ["NEW", "INVESTIGATING", "CLOSED"]) {
      expect(textEditError(status, "rootCause", null), status).toBeNull();
      expect(textEditError(status, "workaround", null), status).toBeNull();
    }
  });
});

describe("resolvedAtPatch", () => {
  const now = new Date(2026, 10, 5, 12, 0);
  const resolvedEarlier = new Date(2026, 10, 1, 9, 0);

  it("stamps the resolution time on RESOLVED", () => {
    expect(resolvedAtPatch("RESOLVED", now, null)).toEqual({ resolvedAt: now });
  });

  it("leaves an existing resolution time untouched when closing", () => {
    expect(resolvedAtPatch("CLOSED", now, resolvedEarlier)).toEqual({});
  });

  it("stamps the resolution time when closing a problem that was never resolved", () => {
    expect(resolvedAtPatch("CLOSED", now, null)).toEqual({ resolvedAt: now });
  });

  it("clears the resolution time when work resumes", () => {
    for (const status of ["NEW", "INVESTIGATING", "KNOWN_ERROR"]) {
      expect(resolvedAtPatch(status, now, resolvedEarlier), status).toEqual({ resolvedAt: null });
    }
  });
});
