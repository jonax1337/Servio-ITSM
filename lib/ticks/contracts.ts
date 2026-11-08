/**
 * Scheduler tick for contracts and licenses: renewal reminders to contract
 * owners (once per period, Contract.renewalNotifiedFor) and license
 * over-allocation alerts (SoftwareLicense.overAllocatedNotifiedAt).
 * Run by lib/scheduler.ts with an overlap guard and error isolation.
 *
 * Decisions live in lib/contract-rules.ts; this file only does the I/O. Each
 * marker is claimed with a conditional update before the notification is sent,
 * so a reminder is never sent twice even if two ticks overlap.
 */
import { db } from "@/lib/db";
import { notify } from "@/lib/audit";
import { getBoolSetting } from "@/lib/settings";
import {
  licenseCompliance,
  overAllocationAction,
  overAllocationMessage,
  renewalReminderDue,
  renewalReminderMessage,
} from "@/lib/contract-rules";

const DAY_MS = 86_400_000;

async function sendRenewalReminders(now: Date): Promise<number> {
  // Contracts that ended before yesterday can no longer be in a notice period.
  const candidates = await db.contract.findMany({
    where: { status: "ACTIVE", ownerId: { not: null }, endDate: { gte: new Date(now.getTime() - DAY_MS) } },
    select: {
      id: true,
      name: true,
      status: true,
      ownerId: true,
      endDate: true,
      autoRenew: true,
      renewalNoticeDays: true,
      renewalNotifiedFor: true,
    },
  });

  let sent = 0;
  for (const contract of candidates) {
    if (!renewalReminderDue(contract, now) || !contract.ownerId || !contract.endDate) continue;
    const claimed = await db.contract.updateMany({
      where: { id: contract.id, renewalNotifiedFor: contract.renewalNotifiedFor },
      data: { renewalNotifiedFor: contract.endDate },
    });
    if (claimed.count === 0) continue;
    await notify(contract.ownerId, {
      type: "CONTRACT_RENEWAL",
      ...renewalReminderMessage({ name: contract.name, endDate: contract.endDate, autoRenew: contract.autoRenew }, now),
      entity: "Contract",
      entityId: contract.id,
      email: { kind: "CONTRACT_RENEWAL", name: contract.name, endDate: contract.endDate, autoRenew: contract.autoRenew },
    });
    sent++;
  }
  return sent;
}

async function sendOverAllocationAlerts(): Promise<number> {
  const licenses = await db.softwareLicense.findMany({
    select: {
      id: true,
      name: true,
      seats: true,
      ownerId: true,
      overAllocatedNotifiedAt: true,
      _count: { select: { assignments: true } },
    },
  });

  let alerted = 0;
  for (const license of licenses) {
    const compliance = licenseCompliance(license.seats, license._count.assignments);
    const action = overAllocationAction(compliance, !!license.ownerId, license.overAllocatedNotifiedAt);
    if (action === "REARM") {
      await db.softwareLicense.update({ where: { id: license.id }, data: { overAllocatedNotifiedAt: null } });
    } else if (action === "NOTIFY" && license.ownerId) {
      const claimed = await db.softwareLicense.updateMany({
        where: { id: license.id, overAllocatedNotifiedAt: null },
        data: { overAllocatedNotifiedAt: new Date() },
      });
      if (claimed.count === 0) continue;
      await notify(license.ownerId, {
        type: "LICENSE_OVER_ALLOCATED",
        ...overAllocationMessage(license, compliance),
        entity: "SoftwareLicense",
        entityId: license.id,
        email: { kind: "LICENSE_OVER_ALLOCATED", name: license.name, used: compliance.used, seats: compliance.seats },
      });
      alerted++;
    }
  }
  return alerted;
}

export async function runContractsTick(): Promise<void> {
  if (!(await getBoolSetting("CONTRACT_REMINDERS_ENABLED", true))) return;

  const reminders = await sendRenewalReminders(new Date());
  const alerts = await sendOverAllocationAlerts();
  if (reminders > 0 || alerts > 0) {
    console.log(`[servio:contracts] sent ${reminders} renewal reminder(s), ${alerts} over-allocation alert(s)`);
  }
}
