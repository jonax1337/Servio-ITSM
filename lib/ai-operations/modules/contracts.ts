import { z } from "zod";
import { db } from "@/lib/db";
import { createContract } from "@/lib/actions/contracts";
import { CONTRACT_TYPES, CONTRACT_TYPE_META } from "@/lib/constants";
import { contractExpiry, daysUntil, isoDay, licenseCompliance } from "@/lib/contract-rules";
import type { AiOperation } from "../types";
import { err, fromActionResult, ok, str, toFormData } from "../helpers";

/**
 * Contracts & licenses. The reads mirror the Contracts page (AGENT); creating a
 * contract mirrors the create action (MANAGER) and reuses it, so validation,
 * audit and the role re-check stay in one place.
 */

const DAY_MS = 86_400_000;
const DEFAULT_WINDOW_DAYS = 90;
const MAX_WINDOW_DAYS = 730;
const MAX_ROWS = 100;

async function vendorIdByName(name: string): Promise<string | null> {
  const wanted = name.toLowerCase();
  const vendors = await db.vendor.findMany({ select: { id: true, name: true } });
  return vendors.find((v) => v.name.toLowerCase() === wanted)?.id ?? null;
}

export const OPERATIONS: AiOperation[] = [
  {
    id: "contract.expiring",
    group: "Contracts",
    kind: "read",
    minRole: "AGENT",
    description:
      "List ACTIVE contracts that end within the next N days (default 90), including ones whose end date already passed but are still marked active. Soonest first, with vendor, owner, days left and whether they auto-renew.",
    input: z.object({
      withinDays: z.number().int().min(1).max(MAX_WINDOW_DAYS).optional().describe(`look-ahead window in days (default ${DEFAULT_WINDOW_DAYS})`),
    }),
    run: async (a) => {
      const now = new Date();
      const windowDays = Number(a.withinDays) || DEFAULT_WINDOW_DAYS;
      const rows = await db.contract.findMany({
        where: { status: "ACTIVE", endDate: { not: null, lte: new Date(now.getTime() + windowDays * DAY_MS) } },
        orderBy: { endDate: "asc" },
        take: MAX_ROWS,
        select: {
          id: true,
          name: true,
          status: true,
          endDate: true,
          renewalNoticeDays: true,
          autoRenew: true,
          vendor: { select: { name: true } },
          owner: { select: { name: true, email: true } },
        },
      });
      if (rows.length === 0) return ok(`No active contracts end within ${windowDays} days.`, { contracts: [] });

      const contracts = rows.map((c) => ({
        id: c.id,
        name: c.name,
        vendor: c.vendor?.name ?? null,
        owner: c.owner ? (c.owner.name ?? c.owner.email) : null,
        endDate: isoDay(c.endDate as Date),
        daysLeft: daysUntil(c.endDate as Date, now),
        expired: contractExpiry(c, now) === "EXPIRED",
        autoRenew: c.autoRenew,
        href: `/contracts/${c.id}`,
      }));
      const expired = contracts.filter((c) => c.expired).length;
      return ok(
        `${contracts.length} active contract(s) end within ${windowDays} days${expired ? `, ${expired} already past their end date` : ""}.`,
        { contracts },
      );
    },
  },
  {
    id: "license.compliance",
    group: "Contracts",
    kind: "read",
    minRole: "AGENT",
    description:
      "Software license compliance: seats purchased vs assigned for each license, flagging over-allocated (more assigned than purchased) and fully used licenses. Pass onlyProblems to list just the over-allocated and full ones.",
    input: z.object({
      onlyProblems: z.boolean().optional().describe("only over-allocated or fully used licenses"),
    }),
    run: async (a) => {
      const rows = await db.softwareLicense.findMany({
        orderBy: { name: "asc" },
        take: 200,
        select: {
          id: true,
          name: true,
          seats: true,
          expiresAt: true,
          vendor: { select: { name: true } },
          _count: { select: { assignments: true } },
        },
      });
      const licenses = rows
        .map((l) => ({ license: l, compliance: licenseCompliance(l.seats, l._count.assignments) }))
        .filter(({ compliance }) => !a.onlyProblems || compliance.state !== "OK")
        .map(({ license, compliance }) => ({
          id: license.id,
          name: license.name,
          vendor: license.vendor?.name ?? null,
          seats: compliance.seats,
          used: compliance.used,
          free: compliance.free,
          overBy: compliance.overBy,
          state: compliance.state,
          expiresAt: license.expiresAt ? isoDay(license.expiresAt) : null,
          href: `/contracts/licenses/${license.id}`,
        }));
      if (licenses.length === 0) {
        return ok(a.onlyProblems ? "No license is over-allocated or fully used." : "No software licenses exist yet.", { licenses: [] });
      }
      const over = licenses.filter((l) => l.state === "OVER").length;
      const full = licenses.filter((l) => l.state === "FULL").length;
      return ok(`${licenses.length} license(s): ${over} over-allocated, ${full} fully used.`, { licenses });
    },
  },
  {
    id: "contract.create",
    group: "Contracts",
    kind: "write",
    minRole: "MANAGER",
    description:
      "Create a vendor contract. The vendor must already exist (by exact name). The acting user becomes the owner and receives the renewal reminder before it ends.",
    input: z.object({
      name: z.string().min(2).describe("contract name"),
      type: z.enum(CONTRACT_TYPES).optional().describe("contract type (default SUPPORT)"),
      vendor: z.string().optional().describe("name of an existing vendor"),
      startDate: z.string().optional().describe("start date, YYYY-MM-DD; omit when it is not known"),
      endDate: z.string().optional().describe("end date, YYYY-MM-DD"),
      cost: z.number().min(0).optional(),
      renewalNoticeDays: z.number().int().min(0).optional().describe("days before the end date to remind the owner (default 30)"),
      autoRenew: z.boolean().optional(),
      number: z.string().optional().describe("the vendor's contract number"),
      notes: z.string().optional(),
    }),
    label: (a) => `Create contract “${a.name}”${a.type ? ` (${CONTRACT_TYPE_META[String(a.type)]?.label ?? a.type})` : ""}`,
    run: async (a, ctx) => {
      const vendorName = str(a.vendor);
      const vendorId = vendorName ? await vendorIdByName(vendorName) : null;
      if (vendorName && !vendorId) return err(`Vendor not found: ${vendorName}. Create the vendor first.`);

      const result = await createContract(
        toFormData({
          name: a.name,
          type: a.type ?? "SUPPORT",
          status: "ACTIVE",
          vendorId,
          ownerId: ctx.userId,
          startDate: a.startDate,
          endDate: a.endDate,
          cost: a.cost,
          renewalNoticeDays: a.renewalNoticeDays,
          autoRenew: a.autoRenew === true,
          number: a.number,
          notes: a.notes,
        }),
      );
      return fromActionResult(result, `Created contract "${a.name}"`);
    },
  },
];
