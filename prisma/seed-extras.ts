import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

async function main() {
  // ---- Locations (tree) + link assets ----
  await db.location.deleteMany();
  const mk = (name: string, type: string, parentId: string | null, extra: Record<string, unknown> = {}) =>
    db.location.create({ data: { name, type, parentId, ...extra } });
  const hq = await mk("HQ Campus", "SITE", null, { city: "Berlin", country: "DE", address: "Alexanderplatz 1" });
  const bld = await mk("HQ Building A", "BUILDING", hq.id);
  const f3 = await mk("3rd Floor", "FLOOR", bld.id);
  const r301 = await mk("Room 301", "ROOM", f3.id);
  const dcA = await mk("Datacenter A", "DATACENTER", hq.id, { city: "Berlin", country: "DE" });
  const rack1 = await mk("Rack 1", "RACK", dcA.id);
  const rack3 = await mk("Rack 3", "RACK", dcA.id);
  const dcB = await mk("Datacenter B", "DATACENTER", null, { city: "Frankfurt", country: "DE" });
  const locMap: Record<string, string> = {
    "SRV-DC01": rack3.id, "SRV-DC02": rack3.id, "FW-EDGE01": rack1.id, "SW-CORE01": rack1.id,
    "NAS-STORE01": dcB.id, "LT-1042": f3.id, "LT-1088": f3.id, "WS-2201": r301.id,
    "PRN-HQ-3F": f3.id, "MON-4501": r301.id,
  };
  for (const [tag, locId] of Object.entries(locMap)) {
    await db.asset.updateMany({ where: { assetTag: tag }, data: { locationId: locId } });
  }

  // ---- Service Catalog items (separate from operational Services) ----
  await db.catalogItem.deleteMany();
  const approver = (await db.user.findFirst({ where: { role: "MANAGER" } })) ?? (await db.user.findFirst({ where: { role: "ADMIN" } }));
  const catId = async (name: string) => (await db.category.findFirst({ where: { name } }))?.id ?? null;

  const items: Array<{ name: string; icon: string; short: string; desc: string; cat: string; days: number; approval: boolean; order: number; fields: unknown }> = [
    {
      name: "New laptop", icon: "Laptop", short: "Request a standard or specialised laptop.", desc: "Order a company laptop for a new starter or as a replacement.",
      cat: "Laptop", days: 3, approval: true, order: 0,
      fields: [
        { key: "device", label: "Which device do you need?", type: "select", required: true, options: ["Standard laptop", "MacBook Pro 14\"", "Developer workstation"] },
        { key: "justification", label: "Business justification", type: "textarea", required: true, placeholder: "Why do you need this?" },
        { key: "neededBy", label: "Needed by", type: "date" },
      ],
    },
    {
      name: "New employee onboarding", icon: "UserPlus", short: "Set up accounts & equipment for a new hire.", desc: "Kick off IT onboarding for a new team member.",
      cat: "Account", days: 5, approval: true, order: 1,
      fields: [
        { key: "name", label: "New employee full name", type: "text", required: true },
        { key: "startDate", label: "Start date", type: "date", required: true },
        { key: "role", label: "Job title", type: "text", required: true },
        { key: "equipment", label: "Equipment needed", type: "select", options: ["Laptop only", "Laptop + monitor", "Full workstation"] },
      ],
    },
    {
      name: "Access request", icon: "KeyRound", short: "Request access to a system or application.", desc: "Ask for access to an internal system with the right permission level.",
      cat: "Permissions", days: 1, approval: true, order: 2,
      fields: [
        { key: "system", label: "System / application", type: "select", required: true, options: ["ERP System", "CRM", "Finance shared drive", "Admin console"] },
        { key: "level", label: "Access level", type: "select", required: true, options: ["Read only", "Read/Write", "Administrator"] },
        { key: "reason", label: "Reason for access", type: "textarea", required: true },
      ],
    },
    {
      name: "VPN access", icon: "ShieldCheck", short: "Get connected to the corporate VPN.", desc: "Request VPN access so you can work securely from anywhere.",
      cat: "VPN", days: 1, approval: false, order: 3, fields: [],
    },
    {
      name: "Software installation", icon: "Package", short: "Request software for your device.", desc: "Ask IT to install approved software on your machine.",
      cat: "Software", days: 2, approval: false, order: 4,
      fields: [
        { key: "software", label: "Which software?", type: "text", required: true, placeholder: "e.g. Adobe Creative Cloud" },
        { key: "device", label: "Device name / asset tag", type: "text" },
      ],
    },
    {
      name: "Monitor & peripherals", icon: "Monitor", short: "Order a monitor, dock or accessories.", desc: "Request additional hardware for your desk.",
      cat: "Desktop", days: 3, approval: false, order: 5,
      fields: [
        { key: "item", label: "What do you need?", type: "select", required: true, options: ["External monitor", "Docking station", "Keyboard & mouse", "Headset"] },
      ],
    },
  ];

  for (const it of items) {
    await db.catalogItem.create({
      data: {
        name: it.name, icon: it.icon, shortDescription: it.short, description: it.desc,
        categoryId: await catId(it.cat), estimatedDays: it.days, order: it.order,
        isPublished: true, requiresApproval: it.approval, approverId: it.approval ? approver?.id : null,
        formSchema: JSON.stringify(it.fields),
      },
    });
  }

  // ---- Automation rules ----
  await db.automationRule.deleteMany();
  const infra = await db.group.findFirst({ where: { name: "Infrastructure" } });
  const sam = await db.user.findFirst({ where: { email: "sam@servio.dev" } });
  if (infra && sam) {
    await db.automationRule.createMany({
      data: [
        { name: "Auto-route VPN incidents to Infrastructure", description: "Any ticket mentioning VPN goes to the Infrastructure team.", trigger: "TICKET_CREATED", matchType: "ALL", order: 0, conditions: JSON.stringify([{ field: "title", op: "contains", value: "vpn" }]), actions: JSON.stringify([{ type: "set_group", value: infra.id }, { type: "internal_note", value: "Auto-routed to Infrastructure (VPN keyword)." }]) },
        { name: "Flag critical tickets", description: "Open and note critical tickets immediately.", trigger: "TICKET_CREATED", matchType: "ALL", order: 1, conditions: JSON.stringify([{ field: "priority", op: "eq", value: "CRITICAL" }]), actions: JSON.stringify([{ type: "set_status", value: "OPEN" }, { type: "notify", value: sam.id }, { type: "internal_note", value: "Critical ticket — flagged for immediate attention." }]) },
        { name: "VIP handling note", description: "Add a note when a VIP raises a ticket.", trigger: "TICKET_CREATED", matchType: "ALL", order: 2, conditions: JSON.stringify([{ field: "requesterVip", op: "eq", value: "true" }]), actions: JSON.stringify([{ type: "internal_note", value: "VIP requester — please prioritise." }]) },
      ],
    });
  }

  // ---- Business calendars + escalation policies (SLA infrastructure) ----
  await db.holiday.deleteMany();
  await db.businessCalendar.deleteMany();
  await db.escalationPolicy.deleteMany();
  // Mon–Fri 09:00–17:00 in Berlin.
  const nine17 = [["09:00", "17:00"]];
  const workHours = JSON.stringify({ sun: [], mon: nine17, tue: nine17, wed: nine17, thu: nine17, fri: nine17, sat: [] });
  const stdCal = await db.businessCalendar.create({
    data: { name: "Standard (Mon–Fri 9–5, Europe/Berlin)", timezone: "Europe/Berlin", weeklyHours: workHours },
  });
  const thisYear = new Date().getFullYear();
  await db.holiday.createMany({
    data: [
      { calendarId: stdCal.id, name: "New Year's Day", date: new Date(`${thisYear}-01-01T00:00:00Z`) },
      { calendarId: stdCal.id, name: "German Unity Day", date: new Date(`${thisYear}-10-03T00:00:00Z`) },
      { calendarId: stdCal.id, name: "Christmas Day", date: new Date(`${thisYear}-12-25T00:00:00Z`) },
    ],
  });

  const manager = (await db.user.findFirst({ where: { role: "MANAGER" } })) ?? approver;
  const desk = await db.group.findFirst({ where: { name: "Service Desk" } });
  const stdEscalation = await db.escalationPolicy.create({
    data: {
      name: "Standard 3-step escalation",
      steps: {
        create: [
          { order: 0, thresholdPercent: 75, action: "NOTIFY", targetUserId: manager?.id ?? null },
          { order: 1, thresholdPercent: 90, action: "NOTIFY", targetGroupId: desk?.id ?? null },
          { order: 2, thresholdPercent: 100, action: "BUMP_PRIORITY", bumpToPriority: "HIGH" },
        ],
      },
    },
  });

  // Attach calendar + escalation to the seeded SLAs so the business-hours and
  // escalation features have live demo data.
  await db.sLA.updateMany({
    where: { OR: [{ name: { contains: "Business" } }, { name: { contains: "Standard" } }] },
    data: { businessCalendarId: stdCal.id, escalationPolicyId: stdEscalation.id },
  });
  // Ensure at least one business-hours SLA exists even if names drift.
  if ((await db.sLA.count({ where: { businessCalendarId: { not: null } } })) === 0) {
    await db.sLA.create({
      data: {
        name: "Business-hours support",
        description: "Resolve within business hours (Mon–Fri 9–5).",
        priority: "MEDIUM",
        responseMins: 240,
        resolveMins: 480,
        isActive: true,
        businessCalendarId: stdCal.id,
        escalationPolicyId: stdEscalation.id,
      },
    });
  }

  // ---- Macros (canned multi-action bundles) ----
  await db.macro.deleteMany();
  const agent = await db.user.findFirst({ where: { email: "sam@servio.dev" } });
  await db.macro.createMany({
    data: [
      {
        name: "Resolve — fixed",
        description: "Mark resolved (fixed) with a friendly public closure reply.",
        isShared: true,
        actions: JSON.stringify([
          { type: "set_status", value: "RESOLVED" },
          { type: "reply", value: "Good news — this is fixed. Could you confirm everything works on your side? If we don't hear back, we'll close the ticket shortly." },
        ]),
      },
      {
        name: "Awaiting customer",
        description: "Park the ticket as pending (awaiting customer) and ask for the missing info.",
        isShared: true,
        actions: JSON.stringify([
          { type: "set_status", value: "PENDING" },
          { type: "reply", value: "To move this forward we need a bit more information from you — could you share the details we asked for above?" },
        ]),
      },
      {
        name: "Escalate to Infrastructure",
        description: "Route to the Infrastructure team and bump the priority one notch.",
        isShared: false,
        ownerId: agent?.id,
        actions: JSON.stringify([
          { type: "set_group", value: infra?.id ?? "" },
          { type: "set_priority", value: "HIGH" },
          { type: "internal_note", value: "Escalated to Infrastructure — needs specialist eyes." },
        ]),
      },
    ],
  });

  // ---- CSAT survey responses on resolved demo tickets ----
  await db.surveyResponse.deleteMany();
  const resolved = await db.ticket.findMany({
    where: { status: "RESOLVED", resolvedAt: { not: null } },
    select: { id: true, resolvedAt: true },
    take: 8,
    orderBy: { resolvedAt: "asc" },
  });
  const ratings = [5, 4, 5, 3, 5, 4, 2, 5];
  const comments = [
    "Fast, friendly help — thank you!",
    "Resolved quickly, though the first reply took a while.",
    "Perfect support.",
    "Took two reminders, but the fix works.",
    null,
    "Good outcome.",
    "Slow response, but the agent was great.",
    "Excellent — above and beyond.",
  ];
  await Promise.all(
    resolved.map((t, i) =>
      db.surveyResponse
        .create({
          data: {
            ticketId: t.id,
            token: `seed-csat-${t.id}`,
            rating: ratings[i % ratings.length],
            comment: comments[i % comments.length],
            sentAt: t.resolvedAt ?? new Date(),
            respondedAt: t.resolvedAt ? new Date(t.resolvedAt.getTime() + 1000 * 60 * 60 * (6 + i)) : new Date(),
          },
        })
        .catch(() => {
          /* ticket may already carry a survey row */
        }),
    ),
  );

  console.log("✅ Seed extras: locations, catalog items, automations, calendars, escalations, macros, CSAT.");
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => db.$disconnect());
