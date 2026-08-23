import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const db = new PrismaClient();

// deterministic pseudo-random so seeds are reproducible
let _s = 42;
const rand = () => {
  _s = (_s * 1103515245 + 12345) & 0x7fffffff;
  return _s / 0x7fffffff;
};
const pick = <T>(arr: readonly T[]): T => arr[Math.floor(rand() * arr.length)];
const pickN = <T>(arr: readonly T[], n: number): T[] => {
  const c = [...arr];
  const out: T[] = [];
  for (let i = 0; i < n && c.length; i++)
    out.push(c.splice(Math.floor(rand() * c.length), 1)[0]);
  return out;
};
const daysAgo = (d: number) => new Date(Date.now() - d * 86400000);
const hoursFromNow = (h: number) => new Date(Date.now() + h * 3600000);

async function main() {
  console.log("🌱 Seeding Servio…");

  // ---- wipe (order matters) ----
  await db.$transaction([
    db.auditLog.deleteMany(),
    db.notification.deleteMany(),
    db.emailMessage.deleteMany(),
    db.apiToken.deleteMany(),
    db.syncRun.deleteMany(),
    db.ticketAsset.deleteMany(),
    db.changeAsset.deleteMany(),
    db.ticketWatcher.deleteMany(),
    db.attachment.deleteMany(),
    db.ticketComment.deleteMany(),
    db.changeApproval.deleteMany(),
    db.assetRelation.deleteMany(),
    db.ticket.deleteMany(),
    db.change.deleteMany(),
    db.problem.deleteMany(),
    db.asset.deleteMany(),
    db.service.deleteMany(),
    db.sLA.deleteMany(),
    db.article.deleteMany(),
    db.category.deleteMany(),
    db.groupMember.deleteMany(),
    db.group.deleteMany(),
    db.syncSource.deleteMany(),
    db.account.deleteMany(),
    db.session.deleteMany(),
    db.user.deleteMany(),
  ]);

  const pw = await bcrypt.hash("servio123", 10);

  // ---- Users ----
  const people = [
    ["Alex Admin", "admin@servio.dev", "ADMIN", "IT Operations Lead", "IT"],
    ["Mara Manager", "mara@servio.dev", "MANAGER", "Service Desk Manager", "IT"],
    ["Sam Rivera", "sam@servio.dev", "AGENT", "Support Engineer", "Service Desk"],
    ["Nora K900", "nora@servio.dev", "AGENT", "Network Engineer", "Infrastructure"],
    ["Theo Brandt", "theo@servio.dev", "AGENT", "Systems Administrator", "Infrastructure"],
    ["Priya Shah", "priya@servio.dev", "AGENT", "Application Support", "Service Desk"],
    ["Liam Chen", "liam@servio.dev", "USER", "Sales Representative", "Sales"],
    ["Emma Wolf", "emma@servio.dev", "USER", "HR Business Partner", "HR"],
    ["Jonas Laux", "jonas@servio.dev", "USER", "Finance Analyst", "Finance"],
    ["Ola Nowak", "ola@servio.dev", "USER", "Marketing Lead", "Marketing"],
    ["Ravi Patel", "ravi@servio.dev", "USER", "Warehouse Supervisor", "Operations"],
    ["Sofia Rossi", "sofia@servio.dev", "USER", "Designer", "Product"],
  ] as const;

  const users: Awaited<ReturnType<typeof db.user.create>>[] = [];
  for (const [name, email, role, title, dept] of people) {
    users.push(
      await db.user.create({
        data: {
          name,
          email,
          role,
          jobTitle: title,
          department: dept,
          passwordHash: pw,
          isActive: true,
          lastLoginAt: daysAgo(Math.floor(rand() * 5)),
        },
      }),
    );
  }
  const byEmail = (e: string) => users.find((u) => u.email === e)!;

  // Mark a few important requesters as VIP
  for (const email of ["liam@servio.dev", "emma@servio.dev", "ola@servio.dev"]) {
    const u = byEmail(email);
    u.isVip = true;
    await db.user.update({ where: { id: u.id }, data: { isVip: true } });
  }
  const agents = users.filter((u) => u.role === "AGENT" || u.role === "MANAGER");
  const endUsers = users.filter((u) => u.role === "USER");

  // ---- Groups ----
  const gServiceDesk = await db.group.create({
    data: { name: "Service Desk", type: "TEAM", color: "#6366f1", email: "servicedesk@servio.dev", description: "First line of support", managerId: byEmail("mara@servio.dev").id },
  });
  const gInfra = await db.group.create({
    data: { name: "Infrastructure", type: "TEAM", color: "#8b5cf6", email: "infra@servio.dev", description: "Servers, network & datacenter", managerId: byEmail("admin@servio.dev").id },
  });
  const gApps = await db.group.create({
    data: { name: "Application Support", type: "TEAM", color: "#0ea5e9", description: "Business application specialists" },
  });
  const gVendor = await db.group.create({
    data: { name: "Acme Cloud (Vendor)", type: "VENDOR", color: "#10b981", description: "External cloud provider" },
  });
  const groups = [gServiceDesk, gInfra, gApps, gVendor];

  await db.groupMember.createMany({
    data: [
      { groupId: gServiceDesk.id, userId: byEmail("sam@servio.dev").id, role: "LEAD" },
      { groupId: gServiceDesk.id, userId: byEmail("priya@servio.dev").id },
      { groupId: gServiceDesk.id, userId: byEmail("mara@servio.dev").id, role: "LEAD" },
      { groupId: gInfra.id, userId: byEmail("nora@servio.dev").id },
      { groupId: gInfra.id, userId: byEmail("theo@servio.dev").id, role: "LEAD" },
      { groupId: gApps.id, userId: byEmail("priya@servio.dev").id, role: "LEAD" },
    ],
  });

  // ---- Categories (tree) ----
  // Clean, type-independent 2-level taxonomy (categories apply to any ticket)
  const mkCat = (name: string, icon: string, color: string, parentId?: string) =>
    db.category.create({ data: { name, icon, color, parentId } });

  const cHardware = await mkCat("Hardware", "HardDrive", "#6366f1");
  const cLaptop = await mkCat("Laptop", "Laptop", "#6366f1", cHardware.id);
  const cDesktop = await mkCat("Desktop", "Monitor", "#6366f1", cHardware.id);
  const cPrinter = await mkCat("Printer", "Printer", "#6366f1", cHardware.id);
  const cSoftware = await mkCat("Software", "AppWindow", "#0ea5e9");
  const cEmail = await mkCat("Email", "Mail", "#10b981", cSoftware.id);
  const cOS = await mkCat("Operating System", "MonitorCog", "#0ea5e9", cSoftware.id);
  const cNetwork = await mkCat("Network", "Network", "#f59e0b");
  const cVpn = await mkCat("VPN", "ShieldCheck", "#f59e0b", cNetwork.id);
  const cWifi = await mkCat("Wi-Fi", "Wifi", "#f59e0b", cNetwork.id);
  const cAccess = await mkCat("Access", "KeyRound", "#8b5cf6");
  const cAccount = await mkCat("Account", "UserPlus", "#8b5cf6", cAccess.id);
  const cPerm = await mkCat("Permissions", "Lock", "#8b5cf6", cAccess.id);
  const cInfra = await mkCat("Infrastructure", "Server", "#6366f1");
  const cOnboard = cAccount; // onboarding requests are routed under Access › Account
  const leafCats = [cLaptop, cDesktop, cPrinter, cEmail, cOS, cVpn, cWifi, cAccount, cPerm];
  const parentCats = [cHardware, cSoftware, cNetwork, cAccess, cInfra];

  // ---- SLAs ----
  const slaGold = await db.sLA.create({ data: { name: "Gold — Critical", priority: "CRITICAL", responseMins: 15, resolveMins: 240, description: "Business critical, 24/7" } });
  const slaSilver = await db.sLA.create({ data: { name: "Silver — Standard", priority: "HIGH", responseMins: 60, resolveMins: 480, description: "Standard business hours" } });
  const slaBronze = await db.sLA.create({ data: { name: "Bronze — Best effort", priority: "MEDIUM", responseMins: 240, resolveMins: 1440, description: "Best effort resolution" } });
  const slas = [slaGold, slaSilver, slaBronze];

  // ---- Services (catalog) ----
  const services = await Promise.all(
    [
      ["Email & Calendar", "Mail", "OPERATIONAL", "HIGH", cEmail.id, slaSilver.id],
      ["VPN Access", "ShieldCheck", "OPERATIONAL", "HIGH", cVpn.id, slaSilver.id],
      ["ERP System", "Boxes", "DEGRADED", "CRITICAL", cSoftware.id, slaGold.id],
      ["File Storage", "FolderOpen", "OPERATIONAL", "MEDIUM", cSoftware.id, slaBronze.id],
      ["New Employee Onboarding", "UserPlus", "OPERATIONAL", "MEDIUM", cOnboard.id, slaSilver.id],
      ["Hardware Request", "Laptop", "OPERATIONAL", "LOW", cLaptop.id, slaBronze.id],
      ["Wi-Fi & Network", "Wifi", "OPERATIONAL", "HIGH", cNetwork.id, slaSilver.id],
      ["Company Website", "Globe", "OPERATIONAL", "MEDIUM", cSoftware.id, slaBronze.id],
    ].map(([name, icon, status, crit, categoryId, slaId], i) =>
      db.service.create({
        data: {
          name: name as string, icon: icon as string, status: status as string,
          criticality: crit as string, categoryId: categoryId as string, slaId: slaId as string,
          ownerId: agents[i % agents.length].id,
          description: `${name} — provided by IT.`,
        },
      }),
    ),
  );

  // ---- Assets (CMDB) ----
  const assetDefs: [string, string, string, string, string?][] = [
    ["SRV-DC01", "SERVER", "Dell PowerEdge R750", "Dell", "Datacenter A / Rack 3"],
    ["SRV-DC02", "SERVER", "Dell PowerEdge R750", "Dell", "Datacenter A / Rack 3"],
    ["SRV-APP01", "VM", "VMware VM", "VMware", "Cluster prod-1"],
    ["SRV-DB01", "VM", "VMware VM", "VMware", "Cluster prod-1"],
    ["FW-EDGE01", "NETWORK", "FortiGate 100F", "Fortinet", "Datacenter A / Rack 1"],
    ["SW-CORE01", "NETWORK", "Cisco Catalyst 9300", "Cisco", "Datacenter A / Rack 1"],
    ["NAS-STORE01", "SERVER", "Synology RS4021", "Synology", "Datacenter B"],
    ["LT-1042", "LAPTOP", "ThinkPad X1 Carbon", "Lenovo", "Office HQ"],
    ["LT-1088", "LAPTOP", "MacBook Pro 14", "Apple", "Office HQ"],
    ["WS-2201", "WORKSTATION", "OptiPlex 7010", "Dell", "Office HQ"],
    ["PRN-HQ-3F", "PRINTER", "HP LaserJet M528", "HP", "Office HQ / 3rd floor"],
    ["MON-4501", "MONITOR", "Dell U2723QE", "Dell", "Office HQ"],
    ["MBL-7781", "PHONE", "iPhone 15", "Apple", "Mobile"],
    ["CLOUD-K8S", "CLOUD", "AKS Cluster", "Microsoft", "Azure West Europe"],
    ["SW-ERP", "SOFTWARE", "ERP Suite 2025", "Acme", "SaaS"],
  ];
  const assets: Awaited<ReturnType<typeof db.asset.create>>[] = [];
  for (const [tag, type, model, manufacturer, location] of assetDefs) {
    assets.push(
      await db.asset.create({
        data: {
          assetTag: tag, name: tag, type, model, manufacturer, location,
          status: pick(["IN_USE", "IN_USE", "IN_USE", "IN_STOCK", "MAINTENANCE"]),
          serial: `SN${Math.floor(rand() * 9e7 + 1e7)}`,
          ownerId: pick(users).id,
          groupId: type === "LAPTOP" || type === "WORKSTATION" || type === "MONITOR" ? gServiceDesk.id : gInfra.id,
          ipAddress: type === "NETWORK" || type === "SERVER" || type === "VM" ? `10.0.${Math.floor(rand() * 5)}.${Math.floor(rand() * 254 + 1)}` : null,
          os: type === "SERVER" ? "Ubuntu 24.04 LTS" : type === "VM" ? "Windows Server 2022" : type === "LAPTOP" ? "Windows 11 Pro" : null,
          ramGb: ["SERVER", "VM", "WORKSTATION", "LAPTOP"].includes(type) ? pick([16, 32, 64, 128]) : null,
          storageGb: ["SERVER", "VM", "WORKSTATION", "LAPTOP"].includes(type) ? pick([256, 512, 1024, 2048]) : null,
          cost: Math.floor(rand() * 4000 + 400),
          purchaseDate: daysAgo(Math.floor(rand() * 900 + 100)),
          warrantyEnd: hoursFromNow(Math.floor(rand() * 500 * 24)),
        },
      }),
    );
  }
  const aByTag = (t: string) => assets.find((a) => a.assetTag === t)!;
  // Asset relations (dependency graph)
  await db.assetRelation.createMany({
    data: [
      { sourceId: aByTag("SRV-APP01").id, targetId: aByTag("SRV-DC01").id, type: "RUNS_ON" },
      { sourceId: aByTag("SRV-DB01").id, targetId: aByTag("SRV-DC02").id, type: "RUNS_ON" },
      { sourceId: aByTag("SW-ERP").id, targetId: aByTag("SRV-APP01").id, type: "DEPENDS_ON" },
      { sourceId: aByTag("SRV-APP01").id, targetId: aByTag("SRV-DB01").id, type: "DEPENDS_ON" },
      { sourceId: aByTag("SRV-DC01").id, targetId: aByTag("SW-CORE01").id, type: "CONNECTS_TO" },
      { sourceId: aByTag("SW-CORE01").id, targetId: aByTag("FW-EDGE01").id, type: "CONNECTS_TO" },
      { sourceId: aByTag("SRV-DB01").id, targetId: aByTag("NAS-STORE01").id, type: "BACKS_UP" },
    ],
  });

  // ---- Tickets ----
  const ticketTitles = [
    "Cannot connect to VPN from home",
    "Outlook keeps crashing on startup",
    "Request: new laptop for onboarding",
    "ERP system is very slow this morning",
    "Password reset for shared mailbox",
    "Wi-Fi drops every few minutes in Building B",
    "Printer on 3rd floor won't print",
    "Access request: Finance shared drive",
    "Laptop screen flickering",
    "Email not syncing on phone",
    "Blue screen after latest update",
    "Need access to CRM for new hire",
    "Monitor not detected via docking station",
    "Two-factor authentication not working",
    "Software install request: Adobe suite",
    "Disk almost full on file server",
    "Cannot open shared calendar",
    "New starter setup — Marketing",
    "Slow internet in the whole office",
    "Request: standing desk & docking station",
    "Teams call quality poor",
    "Account locked out after holiday",
    "Website returning 500 errors intermittently",
    "Backup job failed overnight",
    "VPN certificate expired",
    "Keyboard keys not responding",
    "Request budget approval workflow access",
    "Phone cannot receive corporate email",
    "Server DC02 high CPU alert",
    "Reset MFA device for user",
  ];

  let ticketCount = 0;
  for (let i = 0; i < ticketTitles.length; i++) {
    const title = ticketTitles[i];
    const type = pick(["INCIDENT", "INCIDENT", "INCIDENT", "REQUEST"]);
    const status = pick([
      "NEW", "OPEN", "IN_PROGRESS", "IN_PROGRESS", "PENDING", "ON_HOLD",
      "RESOLVED", "RESOLVED", "CLOSED",
    ]);
    const priority = pick(["LOW", "MEDIUM", "MEDIUM", "HIGH", "HIGH", "CRITICAL"]);
    const created = daysAgo(Math.floor(rand() * 25));
    const isClosed = status === "RESOLVED" || status === "CLOSED";
    const assignee = rand() > 0.15 ? pick(agents) : null;
    const cat = pick(leafCats);
    const grp = pick(groups.slice(0, 3));
    const svc = pick(services);

    const t = await db.ticket.create({
      data: {
        title,
        description: `${title}. Reported by the user via the ${pick(["portal", "phone", "email"])}. Please investigate and follow up.`,
        type,
        prefix: type === "REQUEST" ? "REQ" : "INC",
        status,
        priority,
        impact: pick(["LOW", "MEDIUM", "HIGH"]),
        urgency: pick(["LOW", "MEDIUM", "HIGH"]),
        source: pick(["PORTAL", "PORTAL", "EMAIL", "PHONE", "AGENT"]),
        requesterId: pick(endUsers).id,
        assigneeId: assignee?.id ?? null,
        groupId: grp.id,
        categoryId: cat.id,
        serviceId: svc.id,
        slaId: pick(slas).id,
        createdAt: created,
        dueAt: new Date(created.getTime() + pick([4, 8, 24, 48]) * 3600000),
        firstResponseAt: assignee ? new Date(created.getTime() + Math.floor(rand() * 3 + 1) * 3600000) : null,
        resolvedAt: isClosed ? new Date(created.getTime() + Math.floor(rand() * 3 + 1) * 86400000) : null,
        closedAt: status === "CLOSED" ? new Date(created.getTime() + Math.floor(rand() * 4 + 2) * 86400000) : null,
      },
    });
    ticketCount++;

    // comments
    const nComments = Math.floor(rand() * 4);
    for (let c = 0; c < nComments; c++) {
      await db.ticketComment.create({
        data: {
          ticketId: t.id,
          authorId: (assignee ?? pick(agents)).id,
          isInternal: rand() > 0.6,
          body: pick([
            "Thanks for reaching out — looking into this now.",
            "Could you confirm your device name and location?",
            "I've reproduced the issue, escalating to infrastructure.",
            "Applied a fix, please verify on your end.",
            "Waiting on vendor response, will update shortly.",
            "Rebooted the service, monitoring for recurrence.",
          ]),
          createdAt: new Date(created.getTime() + (c + 1) * 3600000),
        },
      });
    }

    // watchers / assets
    if (rand() > 0.6)
      await db.ticketWatcher.create({ data: { ticketId: t.id, userId: pick(users).id } }).catch(() => {});
    if (rand() > 0.5)
      await db.ticketAsset.create({ data: { ticketId: t.id, assetId: pick(assets).id } }).catch(() => {});
  }

  // ---- Problems ----
  const problemDefs = [
    ["Recurring VPN disconnects for remote users", "INVESTIGATING", "HIGH"],
    ["ERP performance degradation during month-end", "KNOWN_ERROR", "HIGH"],
    ["Intermittent Wi-Fi drops in Building B", "NEW", "MEDIUM"],
    ["Email delivery delays to external domains", "RESOLVED", "MEDIUM"],
  ];
  const problems = [];
  for (const [title, status, priority] of problemDefs) {
    const p = await db.problem.create({
      data: {
        title,
        description: `Root cause analysis in progress for: ${title}.`,
        status, priority, impact: pick(["MEDIUM", "HIGH"]),
        assigneeId: pick(agents).id,
        groupId: gInfra.id,
        categoryId: pick(parentCats).id,
        workaround: status === "KNOWN_ERROR" ? "Restart the affected service; batch heavy jobs off-peak." : null,
        rootCause: status === "RESOLVED" ? "Misconfigured connector timeout; corrected in config." : null,
        createdAt: daysAgo(Math.floor(rand() * 30 + 5)),
        resolvedAt: status === "RESOLVED" ? daysAgo(2) : null,
      },
    });
    problems.push(p);
  }
  // link some open tickets to problems
  const openTickets = await db.ticket.findMany({ where: { status: { in: ["NEW", "OPEN", "IN_PROGRESS", "PENDING"] } }, take: 8 });
  for (const t of openTickets)
    if (rand() > 0.5) await db.ticket.update({ where: { id: t.id }, data: { problemId: pick(problems).id } });

  // ---- Changes ----
  const changeDefs: [string, string, string, string][] = [
    ["Upgrade core switch firmware (SW-CORE01)", "NORMAL", "APPROVAL", "MEDIUM"],
    ["Migrate ERP database to new VM", "NORMAL", "SCHEDULED", "HIGH"],
    ["Emergency patch: firewall CVE", "EMERGENCY", "IN_PROGRESS", "HIGH"],
    ["Standard: monthly OS patching", "STANDARD", "APPROVED", "LOW"],
    ["Decommission legacy file server", "NORMAL", "DRAFT", "MEDIUM"],
    ["Roll out MFA to all staff", "NORMAL", "CLOSED", "MEDIUM"],
  ];
  const changes = [];
  for (const [title, ctype, status, risk] of changeDefs) {
    const start = hoursFromNow(Math.floor(rand() * 240 - 48));
    const ch = await db.change.create({
      data: {
        title,
        description: `Change request: ${title}.`,
        type: ctype, status, risk,
        priority: pick(["MEDIUM", "HIGH"]),
        impact: pick(["MEDIUM", "HIGH"]),
        reason: "Reduce risk and keep systems supported and secure.",
        implementationPlan: "1. Notify stakeholders\n2. Take backup / snapshot\n3. Apply change in maintenance window\n4. Validate\n5. Communicate completion",
        rollbackPlan: "Restore from snapshot / revert firmware to previous version.",
        assigneeId: pick(agents).id,
        groupId: gInfra.id,
        categoryId: cInfra.id,
        problemId: rand() > 0.6 ? pick(problems).id : null,
        plannedStart: start,
        plannedEnd: new Date(start.getTime() + pick([2, 4, 6]) * 3600000),
      },
    });
    changes.push(ch);
    // approvals
    for (const ap of pickN(agents, 2))
      await db.changeApproval
        .create({
          data: {
            changeId: ch.id,
            approverId: ap.id,
            status: status === "APPROVED" || status === "SCHEDULED" || status === "CLOSED" ? "APPROVED" : status === "REJECTED" ? "REJECTED" : "PENDING",
            comment: status === "APPROVED" ? "Looks good, approved." : null,
            decidedAt: status === "APPROVED" ? daysAgo(1) : null,
          },
        })
        .catch(() => {});
    // affected assets
    for (const a of pickN(assets, Math.floor(rand() * 3 + 1)))
      await db.changeAsset.create({ data: { changeId: ch.id, assetId: a.id } }).catch(() => {});
  }

  // ---- Sync sources + runs ----
  const syncDefs: [string, string, string, string][] = [
    ["Corporate Active Directory", "ACTIVE_DIRECTORY", "IMPORT", "USERS"],
    ["Azure AD / Entra ID", "AZURE_AD", "BIDIRECTIONAL", "USERS"],
    ["Intune Device Sync", "INTUNE", "IMPORT", "ASSETS"],
    ["Legacy GLPI Import", "GLPI", "IMPORT", "ALL"],
    ["Asset CSV Upload", "CSV", "IMPORT", "ASSETS"],
  ];
  for (const [name, type, direction, scope] of syncDefs) {
    const src = await db.syncSource.create({
      data: {
        name, type, direction, scope,
        isActive: name !== "Legacy GLPI Import",
        schedule: type === "CSV" ? null : "0 */6 * * *",
        config: JSON.stringify(
          type === "ACTIVE_DIRECTORY" || type === "LDAP"
            ? { host: "ldap://dc01.corp.local", baseDN: "DC=corp,DC=local", bindUser: "svc-servio" }
            : type === "AZURE_AD"
              ? { tenantId: "00000000-aaaa-bbbb-cccc-000000000000", clientId: "servio-app" }
              : { endpoint: "https://example.com/api" },
        ),
        lastRunAt: daysAgo(Math.floor(rand() * 3)),
        lastStatus: pick(["SUCCESS", "SUCCESS", "PARTIAL"]),
      },
    });
    // runs history
    for (let r = 0; r < 4; r++) {
      const created = Math.floor(rand() * 20);
      const updated = Math.floor(rand() * 40);
      const failed = rand() > 0.7 ? Math.floor(rand() * 3) : 0;
      const started = daysAgo(r * 0.25 + rand());
      await db.syncRun.create({
        data: {
          sourceId: src.id,
          status: failed > 0 ? "PARTIAL" : "SUCCESS",
          trigger: r === 0 ? "MANUAL" : "SCHEDULE",
          created, updated, failed,
          log: `Connected to ${type}. Imported ${created} new, updated ${updated}, ${failed} failed.`,
          startedAt: started,
          finishedAt: new Date(started.getTime() + Math.floor(rand() * 120 + 20) * 1000),
        },
      });
    }
  }

  // ---- API token (demo) ----
  const rawToken = "servio_demo_pat_0123456789abcdef";
  await db.apiToken.create({
    data: {
      name: "Demo integration token",
      tokenHash: await bcrypt.hash(rawToken, 10),
      // Prefix length MUST match lib/actions/tokens.ts (18 chars) — lib/api.ts
      // looks tokens up by the exact prefix, so a shorter seed prefix never
      // authenticates.
      prefix: rawToken.slice(0, 18),
      scopes: "read,write",
      userId: byEmail("admin@servio.dev").id,
      lastUsedAt: daysAgo(1),
    },
  });

  // ---- Knowledge base articles ----
  // [title, slug, excerpt, visibility, status]
  const articleDefs: [string, string, string, "PUBLIC" | "INTERNAL", "PUBLISHED" | "DRAFT" | "REVIEW"][] = [
    ["How to connect to the VPN", "how-to-connect-vpn", "Step-by-step guide to installing and connecting to the corporate VPN client on Windows and macOS.", "PUBLIC", "PUBLISHED"],
    ["Reset your password", "reset-your-password", "You can reset your password from the self-service portal in under a minute.", "PUBLIC", "PUBLISHED"],
    ["Request a new laptop", "request-new-laptop", "Use the Hardware Request service to order a standard or specialised device.", "PUBLIC", "PUBLISHED"],
    ["Set up email on your phone", "email-on-your-phone", "Configure corporate email on iOS and Android using the company profile.", "PUBLIC", "PUBLISHED"],
    ["Wi-Fi troubleshooting", "wifi-troubleshooting", "Common fixes for Wi-Fi connectivity problems in the office.", "PUBLIC", "PUBLISHED"],
    // Internal runbook — agents only, must never surface in the portal.
    ["Runbook: VPN concentrator failover", "runbook-vpn-failover", "Internal procedure for failing over the VPN concentrator during an outage.", "INTERNAL", "PUBLISHED"],
    // A draft to show the authoring lifecycle.
    ["New starter IT checklist", "new-starter-it-checklist", "Draft checklist of accounts and equipment to provision for new hires.", "PUBLIC", "DRAFT"],
  ];
  for (const [title, slug, excerpt, visibility, status] of articleDefs) {
    const isPublished = status === "PUBLISHED";
    const author = pick(agents);
    await db.article.create({
      data: {
        title, slug, excerpt,
        body: `## ${title}\n\n${excerpt}\n\n1. Open the self-service portal.\n2. Follow the on-screen steps.\n3. Contact the Service Desk if you need help.\n\n> Tip: You can track all your requests under **My Tickets**.`,
        bodyFormat: "markdown",
        status,
        visibility,
        published: isPublished,
        publishedAt: isPublished ? daysAgo(Math.floor(rand() * 30 + 1)) : null,
        categoryId: pick(parentCats).id,
        authorId: author.id,
        views: isPublished ? Math.floor(rand() * 400 + 20) : 0,
        revisions: {
          create: { version: 1, title, excerpt, body: `## ${title}\n\n${excerpt}`, editorId: author.id, note: "Seeded" },
        },
      },
    });
  }

  // ---- Notifications + audit ----
  for (const u of agents.slice(0, 4)) {
    await db.notification.createMany({
      data: [
        { userId: u.id, type: "ASSIGNED", title: "Ticket assigned to you", body: "A new high priority ticket needs attention.", read: false },
        { userId: u.id, type: "SLA", title: "SLA breach warning", body: "A ticket is approaching its resolution deadline.", read: rand() > 0.5 },
      ],
    });
  }
  await db.auditLog.createMany({
    data: Array.from({ length: 12 }).map(() => ({
      userId: pick(agents).id,
      action: pick(["CREATE", "UPDATE", "LOGIN", "SYNC"]),
      entity: pick(["Ticket", "Asset", "Change", "User"]),
      entityId: String(Math.floor(rand() * 100)),
      summary: pick(["Updated status", "Assigned owner", "Signed in", "Ran sync job", "Created record"]),
      createdAt: daysAgo(rand() * 5),
    })),
  });

  console.log(`✅ Seed complete: ${users.length} users, ${groups.length} groups, ${ticketCount} tickets, ${problems.length} problems, ${changes.length} changes, ${assets.length} assets, ${services.length} services.`);
  console.log("👤 Login: admin@servio.dev / servio123");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
