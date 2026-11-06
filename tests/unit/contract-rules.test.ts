import { describe, expect, it } from "vitest";
import {
  ASSIGNMENT_DUPLICATE,
  ASSIGNMENT_NEEDS_TARGET,
  CONTRACT_END_BEFORE_START,
  assignmentError,
  contractDateError,
  contractExpiry,
  daysUntil,
  expiryNotice,
  formatCost,
  formatDay,
  licenseCompliance,
  licenseExpiry,
  overAllocationAction,
  overAllocationMessage,
  renewalReminderDue,
  renewalReminderMessage,
} from "@/lib/contract-rules";

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const now = new Date("2026-11-05T14:30:00.000Z");

describe("daysUntil", () => {
  it("counts calendar days, ignoring the time of day", () => {
    expect(daysUntil(day("2026-11-05"), now)).toBe(0);
    expect(daysUntil(day("2026-11-06"), now)).toBe(1);
    expect(daysUntil(day("2026-12-05"), now)).toBe(30);
    expect(daysUntil(day("2026-11-04"), now)).toBe(-1);
  });
});

describe("contractExpiry", () => {
  const base = { status: "ACTIVE", renewalNoticeDays: 30 };

  it("is OK before the notice period opens and EXPIRING on its first day", () => {
    expect(contractExpiry({ ...base, endDate: day("2026-12-06") }, now)).toBe("OK");
    expect(contractExpiry({ ...base, endDate: day("2026-12-05") }, now)).toBe("EXPIRING");
  });

  it("stays EXPIRING through the end date and is EXPIRED the day after", () => {
    expect(contractExpiry({ ...base, endDate: day("2026-11-05") }, now)).toBe("EXPIRING");
    expect(contractExpiry({ ...base, endDate: day("2026-11-04") }, now)).toBe("EXPIRED");
  });

  it("honours a per-contract notice period", () => {
    expect(contractExpiry({ ...base, renewalNoticeDays: 0, endDate: day("2026-11-06") }, now)).toBe("OK");
    expect(contractExpiry({ ...base, renewalNoticeDays: 90, endDate: day("2027-01-30") }, now)).toBe("EXPIRING");
  });

  it("has nothing to watch without an end date or for drafts and terminated contracts", () => {
    expect(contractExpiry({ ...base, endDate: null }, now)).toBe("NONE");
    expect(contractExpiry({ ...base, status: "DRAFT", endDate: day("2026-11-10") }, now)).toBe("NONE");
    expect(contractExpiry({ ...base, status: "TERMINATED", endDate: day("2026-11-10") }, now)).toBe("NONE");
  });

  it("trusts a stored EXPIRED status over the dates", () => {
    expect(contractExpiry({ ...base, status: "EXPIRED", endDate: day("2027-01-01") }, now)).toBe("EXPIRED");
  });
});

describe("renewalReminderDue", () => {
  const due = {
    status: "ACTIVE",
    ownerId: "u1",
    endDate: day("2026-11-20"),
    renewalNoticeDays: 30,
    renewalNotifiedFor: null as Date | null,
  };

  it("fires inside the notice period for an active contract with an owner", () => {
    expect(renewalReminderDue(due, now)).toBe(true);
  });

  it("does not fire before the notice period", () => {
    expect(renewalReminderDue({ ...due, endDate: day("2027-03-01") }, now)).toBe(false);
  });

  it("fires at most once per end date", () => {
    const notified = { ...due, renewalNotifiedFor: due.endDate };
    expect(renewalReminderDue(notified, now)).toBe(false);
    expect(renewalReminderDue(notified, new Date("2026-11-19T10:00:00.000Z"))).toBe(false);
  });

  it("re-arms when a renewal moves the end date", () => {
    const renewed = { ...due, endDate: day("2026-11-25"), renewalNotifiedFor: day("2026-11-20") };
    expect(renewalReminderDue(renewed, now)).toBe(true);
  });

  it("stays quiet without an owner, after expiry, and for non-active contracts", () => {
    expect(renewalReminderDue({ ...due, ownerId: null }, now)).toBe(false);
    expect(renewalReminderDue({ ...due, endDate: day("2026-11-01") }, now)).toBe(false);
    expect(renewalReminderDue({ ...due, status: "DRAFT" }, now)).toBe(false);
    expect(renewalReminderDue({ ...due, status: "TERMINATED" }, now)).toBe(false);
    expect(renewalReminderDue({ ...due, endDate: null }, now)).toBe(false);
  });
});

describe("renewalReminderMessage", () => {
  it("states when the contract ends and what happens next", () => {
    const lapse = renewalReminderMessage({ name: "Acme Support", endDate: day("2026-11-20"), autoRenew: false }, now);
    expect(lapse.title).toBe('Contract "Acme Support" ends in 15 days');
    expect(lapse.body).toBe("Ends 2026-11-20. It will lapse unless you renew it.");

    const auto = renewalReminderMessage({ name: "Acme Support", endDate: day("2026-11-20"), autoRenew: true }, now);
    expect(auto.body).toContain("renews automatically");
  });

  it("uses natural wording for today and tomorrow", () => {
    expect(renewalReminderMessage({ name: "A", endDate: day("2026-11-05"), autoRenew: false }, now).title).toContain("ends today");
    expect(renewalReminderMessage({ name: "A", endDate: day("2026-11-06"), autoRenew: false }, now).title).toContain("ends tomorrow");
  });
});

describe("licenseCompliance", () => {
  it("is OK while seats are free", () => {
    expect(licenseCompliance(10, 4)).toEqual({ seats: 10, used: 4, free: 6, overBy: 0, state: "OK" });
  });

  it("is FULL when every seat is used and OVER beyond that", () => {
    expect(licenseCompliance(10, 10)).toMatchObject({ free: 0, overBy: 0, state: "FULL" });
    expect(licenseCompliance(10, 13)).toMatchObject({ free: 0, overBy: 3, state: "OVER" });
  });

  it("treats an unused license as OK", () => {
    expect(licenseCompliance(1, 0).state).toBe("OK");
  });
});

describe("overAllocationAction", () => {
  const over = licenseCompliance(5, 7);
  const ok = licenseCompliance(5, 5);
  const alertedAt = new Date("2026-11-01T00:00:00.000Z");

  it("alerts the owner the first time the license is over-allocated", () => {
    expect(overAllocationAction(over, true, null)).toBe("NOTIFY");
  });

  it("does not alert twice while the overrun persists", () => {
    expect(overAllocationAction(over, true, alertedAt)).toBe("NONE");
  });

  it("holds the alert until an owner exists", () => {
    expect(overAllocationAction(over, false, null)).toBe("NONE");
  });

  it("clears the marker once compliant so a later overrun alerts again", () => {
    expect(overAllocationAction(ok, true, alertedAt)).toBe("REARM");
    expect(overAllocationAction(ok, true, null)).toBe("NONE");
  });
});

describe("overAllocationMessage", () => {
  it("reports the numbers", () => {
    const msg = overAllocationMessage({ name: "Office 365" }, licenseCompliance(5, 8));
    expect(msg.title).toBe('License "Office 365" is over-allocated');
    expect(msg.body).toBe("8 seats assigned but only 5 purchased (3 over).");
  });
});

describe("contractDateError", () => {
  it("rejects an end date before the start date", () => {
    expect(contractDateError(day("2026-06-01"), day("2026-05-31"))).toBe(CONTRACT_END_BEFORE_START);
  });

  it("accepts an equal end date, a later one, and none", () => {
    expect(contractDateError(day("2026-06-01"), day("2026-06-01"))).toBeNull();
    expect(contractDateError(day("2026-06-01"), day("2027-06-01"))).toBeNull();
    expect(contractDateError(day("2026-06-01"), null)).toBeNull();
  });
});

describe("assignmentError", () => {
  const existing = [{ userId: "u1", assetId: null }, { userId: null, assetId: "a1" }];

  it("needs a user or an asset", () => {
    expect(assignmentError({ userId: null, assetId: null }, existing)).toBe(ASSIGNMENT_NEEDS_TARGET);
  });

  it("rejects the same pairing twice", () => {
    expect(assignmentError({ userId: "u1", assetId: null }, existing)).toBe(ASSIGNMENT_DUPLICATE);
    expect(assignmentError({ userId: null, assetId: "a1" }, existing)).toBe(ASSIGNMENT_DUPLICATE);
  });

  it("allows a different pairing involving the same user or asset", () => {
    expect(assignmentError({ userId: "u1", assetId: "a1" }, existing)).toBeNull();
    expect(assignmentError({ userId: "u2", assetId: null }, existing)).toBeNull();
  });
});

describe("formatDay and formatCost", () => {
  it("formats a stored calendar day in UTC, whatever the server time zone", () => {
    expect(formatDay(day("2026-11-05"))).toBe("Nov 5, 2026");
    expect(formatDay(new Date("2026-01-01T00:00:00.000Z"))).toBe("Jan 1, 2026");
  });

  it("formats an amount with two decimals and thousands separators", () => {
    expect(formatCost(12500.5)).toBe("12,500.50");
    expect(formatCost(0)).toBe("0.00");
  });
});

describe("licenseExpiry", () => {
  it("reuses the default renewal window", () => {
    expect(licenseExpiry(null, now)).toBe("NONE");
    expect(licenseExpiry(day("2026-12-05"), now)).toBe("EXPIRING");
    expect(licenseExpiry(day("2026-12-06"), now)).toBe("OK");
    expect(licenseExpiry(day("2026-11-04"), now)).toBe("EXPIRED");
  });
});

describe("expiryNotice", () => {
  const contract = { status: "ACTIVE", renewalNoticeDays: 30, autoRenew: false };

  it("is null while the contract is fine or has nothing to watch", () => {
    expect(expiryNotice({ ...contract, endDate: day("2027-06-01") }, now)).toBeNull();
    expect(expiryNotice({ ...contract, endDate: null }, now)).toBeNull();
    expect(expiryNotice({ ...contract, status: "TERMINATED", endDate: day("2026-11-10") }, now)).toBeNull();
  });

  it("warns inside the notice period and says what happens next", () => {
    const lapses = expiryNotice({ ...contract, endDate: day("2026-11-20") }, now);
    expect(lapses?.tone).toBe("warning");
    expect(lapses?.text).toContain("Nov 20, 2026");
    expect(lapses?.text).toContain("30-day notice period");
    expect(lapses?.text).toContain("lapses unless you renew");
    expect(expiryNotice({ ...contract, autoRenew: true, endDate: day("2026-11-20") }, now)?.text).toContain("renews automatically");
  });

  it("is a danger once the end date has passed, and when the stored status says expired", () => {
    const past = expiryNotice({ ...contract, endDate: day("2026-10-01") }, now);
    expect(past?.tone).toBe("danger");
    expect(past?.text).toContain("ended on Oct 1, 2026");
    const flagged = expiryNotice({ ...contract, status: "EXPIRED", endDate: day("2027-06-01") }, now);
    expect(flagged?.text).toContain("marked as expired");
  });
});
