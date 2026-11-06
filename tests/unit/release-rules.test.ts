import { describe, expect, it } from "vitest";
import {
  allowedReleaseTransitions,
  blockerMessage,
  bundleError,
  isBundleEditable,
  isReleaseFinished,
  releaseReadiness,
  releaseSearchId,
  releaseTransitionError,
  releaseWindow,
  shouldStampDeployedAt,
  type ReleaseMember,
} from "@/lib/release-rules";
import { RELEASE_STATUSES } from "@/lib/constants";

const at = (iso: string) => new Date(iso);

const member = (id: number, status: string, start: string | null = null, end: string | null = null): ReleaseMember => ({
  id,
  status,
  plannedStart: start ? at(start) : null,
  plannedEnd: end ? at(end) : null,
});

describe("release lifecycle", () => {
  it("only lists known statuses as transition targets", () => {
    for (const from of RELEASE_STATUSES) {
      for (const to of allowedReleaseTransitions(from)) expect(RELEASE_STATUSES).toContain(to);
    }
  });

  it("treats deployed and cancelled as finished", () => {
    expect(isReleaseFinished("DEPLOYED")).toBe(true);
    expect(isReleaseFinished("CANCELLED")).toBe(true);
    expect(isReleaseFinished("PLANNING")).toBe(false);
    expect(isReleaseFinished("IN_PROGRESS")).toBe(false);
  });

  it("lets the bundle change only while planning", () => {
    expect(isBundleEditable("PLANNING")).toBe(true);
    for (const status of ["READY", "IN_PROGRESS", "DEPLOYED", "CANCELLED"]) expect(isBundleEditable(status)).toBe(false);
  });

  it("stamps the deploy time once", () => {
    expect(shouldStampDeployedAt("DEPLOYED", null)).toBe(true);
    expect(shouldStampDeployedAt("DEPLOYED", at("2026-01-01"))).toBe(false);
    expect(shouldStampDeployedAt("IN_PROGRESS", null)).toBe(false);
  });
});

describe("releaseReadiness", () => {
  it("is not ready without changes", () => {
    const r = releaseReadiness([]);
    expect(r).toMatchObject({ active: 0, ready: false, summary: "No changes bundled yet." });
  });

  it("is ready when every change has cleared approval", () => {
    const r = releaseReadiness([member(1, "APPROVED"), member(2, "SCHEDULED"), member(3, "CLOSED")]);
    expect(r).toMatchObject({ active: 3, approved: 3, ready: true, summary: "All 3 changes are approved." });
    expect(r.blockers).toEqual([]);
  });

  it("names each blocker with the reason", () => {
    const r = releaseReadiness([member(1, "APPROVED"), member(2, "DRAFT"), member(3, "APPROVAL"), member(4, "REJECTED"), member(5, "FAILED")]);
    expect(r.ready).toBe(false);
    expect(r.blockers.map((b) => b.changeId)).toEqual([2, 3, 4, 5]);
    expect(r.summary).toBe("1 of 5 changes approved, 4 blocking.");
    expect(blockerMessage(r.blockers[0])).toBe("Draft: this change has not been submitted for approval.");
  });

  it("ignores cancelled changes", () => {
    const r = releaseReadiness([member(1, "APPROVED"), member(2, "CANCELLED")]);
    expect(r).toMatchObject({ active: 1, ready: true, summary: "All 1 change is approved." });
  });

  it("is not ready when only cancelled changes remain", () => {
    expect(releaseReadiness([member(1, "CANCELLED")]).ready).toBe(false);
  });
});

describe("releaseTransitionError", () => {
  const approved = [member(1, "APPROVED")];
  const blocked = [member(1, "APPROVED"), member(2, "DRAFT")];

  it("rejects moves the lifecycle does not allow", () => {
    expect(releaseTransitionError("PLANNING", "DEPLOYED", approved)).toBe("A release cannot move from Planning to Deployed.");
    expect(releaseTransitionError("DEPLOYED", "PLANNING", approved)).toContain("cannot move");
    expect(releaseTransitionError("CANCELLED", "READY", approved)).toContain("cannot move");
  });

  it("gates READY, IN_PROGRESS and DEPLOYED on readiness", () => {
    expect(releaseTransitionError("PLANNING", "READY", blocked)).toContain("1 of 2 changes approved, 1 blocking.");
    expect(releaseTransitionError("READY", "IN_PROGRESS", blocked)).toContain("Not every change is approved");
    expect(releaseTransitionError("IN_PROGRESS", "DEPLOYED", blocked)).toContain("Not every change is approved");
    expect(releaseTransitionError("PLANNING", "READY", approved)).toBeNull();
    expect(releaseTransitionError("READY", "IN_PROGRESS", approved)).toBeNull();
    expect(releaseTransitionError("IN_PROGRESS", "DEPLOYED", approved)).toBeNull();
  });

  it("refuses to go ahead with an empty bundle", () => {
    expect(releaseTransitionError("PLANNING", "READY", [])).toBe("Bundle at least one change before the release can go ahead.");
  });

  it("never gates stepping back or cancelling", () => {
    expect(releaseTransitionError("READY", "PLANNING", blocked)).toBeNull();
    expect(releaseTransitionError("PLANNING", "CANCELLED", [])).toBeNull();
    expect(releaseTransitionError("IN_PROGRESS", "CANCELLED", blocked)).toBeNull();
  });
});

describe("releaseWindow", () => {
  it("spans earliest start to latest end", () => {
    const w = releaseWindow([
      member(1, "APPROVED", "2026-03-02T22:00", "2026-03-03T01:00"),
      member(2, "APPROVED", "2026-03-01T20:00", "2026-03-01T22:00"),
    ]);
    expect(w).toEqual({ start: at("2026-03-01T20:00"), end: at("2026-03-03T01:00") });
  });

  it("is empty when no change is planned", () => {
    expect(releaseWindow([member(1, "DRAFT")])).toEqual({ start: null, end: null });
    expect(releaseWindow([])).toEqual({ start: null, end: null });
  });

  it("keeps a half-planned window half-planned", () => {
    expect(releaseWindow([member(1, "DRAFT", "2026-03-01T20:00", null)])).toEqual({ start: at("2026-03-01T20:00"), end: null });
  });

  it("skips cancelled changes", () => {
    const w = releaseWindow([
      member(1, "APPROVED", "2026-03-02T00:00", "2026-03-02T02:00"),
      member(2, "CANCELLED", "2026-01-01T00:00", "2026-06-01T00:00"),
    ]);
    expect(w).toEqual({ start: at("2026-03-02T00:00"), end: at("2026-03-02T02:00") });
  });
});

describe("bundleError", () => {
  it("lets a free, open change join", () => {
    expect(bundleError({ status: "DRAFT", releaseId: null }, 3)).toBeNull();
    expect(bundleError({ status: "REJECTED", releaseId: null }, 3)).toBeNull();
  });

  it("refuses a change that is already bundled", () => {
    expect(bundleError({ status: "DRAFT", releaseId: 3 }, 3)).toBe("This change is already part of the release.");
    expect(bundleError({ status: "DRAFT", releaseId: 4 }, 3)).toBe("This change already ships in REL-0004. Remove it there first.");
  });

  it("refuses closed and cancelled changes", () => {
    expect(bundleError({ status: "CLOSED", releaseId: null }, 3)).toContain("closed or cancelled");
    expect(bundleError({ status: "CANCELLED", releaseId: null }, 3)).toContain("closed or cancelled");
  });
});

describe("releaseSearchId", () => {
  it("understands release references", () => {
    for (const q of ["REL-0003", "rel-3", "#3", "3", " 3 "]) expect(releaseSearchId(q)).toBe(3);
  });

  it("treats anything else as a name search", () => {
    for (const q of ["March update", "CHG-0003", "0", "", "99999999999"]) expect(releaseSearchId(q)).toBeNull();
  });
});
