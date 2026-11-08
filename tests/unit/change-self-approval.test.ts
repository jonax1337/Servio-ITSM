import { describe, expect, it } from "vitest";
import {
  CHANGE_SELF_APPROVAL_ERROR,
  CHANGE_SELF_APPROVAL_MODES,
  SELF_APPROVAL_COMMENT_ERROR,
  SELF_APPROVAL_ROLE_ERROR,
  changeSelfApprovalError,
  isChangeSelfApproval,
  parseSelfApprovalMode,
  selfApprovalCommentError,
  selfDecisionSettlesBoard,
  type ChangeSelfApprovalMode,
  type SelfApprovalScope,
} from "@/lib/approval-rules";
import { boardSizeLimit, seatBoard, type SelfSeatCandidate } from "@/lib/change-rules";
import { approverRolesForRisk } from "@/lib/cab";
import { refusalStatus } from "@/lib/api-itsm-input";
import { translateServerMessage } from "@/lib/i18n/translate";

const change = { createdById: "requester", assigneeId: "owner" };
const normalRoles = approverRolesForRisk("MEDIUM");
const highRoles = approverRolesForRisk("HIGH");
const scope = (overrides: Partial<SelfApprovalScope> = {}): SelfApprovalScope => ({
  mode: "WHEN_NO_OTHER_APPROVER",
  approverId: "owner",
  role: "ADMIN",
  eligibleRoles: normalRoles,
  ...overrides,
});

describe("self-approval mode setting", () => {
  it("offers the three modes, OFF first", () => {
    expect(CHANGE_SELF_APPROVAL_MODES).toEqual(["OFF", "WHEN_NO_OTHER_APPROVER", "ALWAYS"]);
  });

  it.each(CHANGE_SELF_APPROVAL_MODES)("reads the stored mode %s back", (mode) => {
    expect(parseSelfApprovalMode(mode)).toBe(mode);
  });

  it.each([null, undefined, "", "true", "on", "always"])("treats %s as OFF", (value) => {
    expect(parseSelfApprovalMode(value)).toBe("OFF");
  });
});

describe("isChangeSelfApproval", () => {
  it("is a self-approval for the requester and the owner only", () => {
    expect(isChangeSelfApproval(change, "requester")).toBe(true);
    expect(isChangeSelfApproval(change, "owner")).toBe(true);
    expect(isChangeSelfApproval(change, "cab-member")).toBe(false);
    expect(isChangeSelfApproval({ createdById: null, assigneeId: null }, "cab-member")).toBe(false);
  });
});

describe("changeSelfApprovalError with a self-approval scope", () => {
  it("keeps the four-eyes refusal when the mode is OFF", () => {
    expect(changeSelfApprovalError(change, "owner", scope({ mode: "OFF" }))).toBe(CHANGE_SELF_APPROVAL_ERROR);
  });

  it.each(["WHEN_NO_OTHER_APPROVER", "ALWAYS"] as const)("lets the owner and requester decide their own seat in %s", (mode) => {
    expect(changeSelfApprovalError(change, "owner", scope({ mode }))).toBeNull();
    expect(changeSelfApprovalError(change, "requester", scope({ mode, approverId: "requester" }))).toBeNull();
  });

  it("never lets them decide another approver's seat through the admin override", () => {
    expect(changeSelfApprovalError(change, "owner", scope({ mode: "ALWAYS", approverId: "cab-member" }))).toBe(
      CHANGE_SELF_APPROVAL_ERROR,
    );
  });

  it("does not bypass the role a high-risk change requires", () => {
    const managerOnHigh = scope({ mode: "ALWAYS", role: "MANAGER", eligibleRoles: highRoles });
    expect(changeSelfApprovalError(change, "owner", managerOnHigh)).toBe(SELF_APPROVAL_ROLE_ERROR);
    expect(changeSelfApprovalError(change, "owner", { ...managerOnHigh, role: "ADMIN" })).toBeNull();
  });

  it("leaves other approvers alone whatever the scope says", () => {
    expect(changeSelfApprovalError(change, "cab-member", scope({ mode: "OFF", approverId: "cab-member" }))).toBeNull();
  });
});

describe("self-approval justification", () => {
  it.each([null, undefined, "", "   "])("requires a comment (%s)", (comment) => {
    expect(selfApprovalCommentError(comment)).toBe(SELF_APPROVAL_COMMENT_ERROR);
  });

  it("accepts a written justification", () => {
    expect(selfApprovalCommentError("Single administrator; reviewed the rollback plan.")).toBeNull();
  });
});

describe("settling the board with a self-decision", () => {
  it.each([
    ["OFF", false],
    ["WHEN_NO_OTHER_APPROVER", false],
    ["ALWAYS", true],
  ] as const)("%s settles alone: %s", (mode, settles) => {
    expect(selfDecisionSettlesBoard(mode)).toBe(settles);
  });
});

describe("seatBoard", () => {
  const person = (id: string, role = "ADMIN", isActive = true): SelfSeatCandidate => ({ id, role, isActive });
  const parties = [person("owner"), person("requester", "MANAGER")];
  const seat = (mode: ChangeSelfApprovalMode, input: { selected?: string[]; kept?: string[]; risk?: string; type?: string } = {}) =>
    seatBoard({
      mode,
      selected: input.selected ?? [],
      kept: input.kept ?? [],
      parties,
      eligibleRoles: approverRolesForRisk(input.risk ?? "MEDIUM"),
      limit: boardSizeLimit(input.type ?? "NORMAL"),
    });

  it("OFF seats exactly the auto-selected board, even when it is empty", () => {
    expect(seat("OFF", { selected: ["a1"], kept: ["m1"] })).toEqual({ autoIds: ["a1"], selfIds: [] });
    expect(seat("OFF")).toEqual({ autoIds: [], selfIds: [] });
  });

  it("WHEN_NO_OTHER_APPROVER seats the owner and requester only on an otherwise empty board", () => {
    expect(seat("WHEN_NO_OTHER_APPROVER")).toEqual({ autoIds: [], selfIds: ["owner", "requester"] });
    expect(seat("WHEN_NO_OTHER_APPROVER", { selected: ["a1"] })).toEqual({ autoIds: ["a1"], selfIds: [] });
    expect(seat("WHEN_NO_OTHER_APPROVER", { kept: ["m1"] })).toEqual({ autoIds: [], selfIds: [] });
  });

  it("ALWAYS seats the owner and requester next to the auto-selected board", () => {
    expect(seat("ALWAYS", { selected: ["a1", "a2"] })).toEqual({ selfIds: ["owner", "requester"], autoIds: ["a1", "a2"] });
  });

  it("ALWAYS gives them priority on an emergency board, but never over kept manual seats", () => {
    expect(seat("ALWAYS", { selected: ["a1", "a2"], type: "EMERGENCY" })).toEqual({ selfIds: ["owner", "requester"], autoIds: [] });
    expect(seat("ALWAYS", { selected: ["a1"], kept: ["m1"], type: "EMERGENCY" })).toEqual({ selfIds: ["owner"], autoIds: [] });
  });

  it.each(["WHEN_NO_OTHER_APPROVER", "ALWAYS"] as const)("%s never seats a manager on a high-risk change", (mode) => {
    expect(seat(mode, { risk: "HIGH" }).selfIds).toEqual(["owner"]);
  });

  it("skips a deactivated owner or requester and seats one person once", () => {
    const board = seatBoard({
      mode: "WHEN_NO_OTHER_APPROVER",
      selected: [],
      kept: [],
      parties: [person("solo"), person("solo"), person("gone", "ADMIN", false)],
      eligibleRoles: normalRoles,
    });
    expect(board.selfIds).toEqual(["solo"]);
  });
});

describe("self-approval refusals on the REST API", () => {
  it.each([
    [CHANGE_SELF_APPROVAL_ERROR, 409],
    [SELF_APPROVAL_ROLE_ERROR, 403],
    [SELF_APPROVAL_COMMENT_ERROR, 422],
  ] as const)("%s -> %i", (message, status) => {
    expect(refusalStatus(message)).toBe(status);
  });
});

describe("self-approval refusals in German", () => {
  it.each([CHANGE_SELF_APPROVAL_ERROR, SELF_APPROVAL_ROLE_ERROR, SELF_APPROVAL_COMMENT_ERROR, "Pick a self-approval mode."])(
    "translates %s",
    (message) => {
      const german = translateServerMessage("de", message);
      expect(german).not.toBe(message);
      expect(german).toMatch(/Change|Selbstgenehmigung/);
    },
  );
});
