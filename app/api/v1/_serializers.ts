import { changeRef, problemRef, ticketRef } from "@/lib/constants";
import { effectiveDue } from "@/lib/api-ticket-input";
import { recurrenceOf } from "@/lib/recurring-ticket-input";
import { creationTimeFor } from "@/lib/recurring-ticket-rules";

type Userish = { id: string; name: string | null; email: string } | null;

function user(u: Userish) {
  return u ? { id: u.id, name: u.name, email: u.email } : null;
}

export function serializeTicket(t: {
  id: number;
  title: string;
  description: string;
  type: string;
  prefix?: string | null;
  status: string;
  priority: string;
  impact: string;
  urgency: string;
  source: string;
  requester?: Userish;
  assignee?: Userish;
  categoryId: string | null;
  serviceId: string | null;
  groupId?: string | null;
  problemId?: number | null;
  changeId?: number | null;
  importRef?: string | null;
  externalRef?: string | null;
  openExternalRef?: string | null;
  dueAt: Date | null;
  /** Manual due date of an agent (independent of the SLA clock). */
  dueDate?: Date | null;
  resolveDueAt?: Date | null;
  resolvedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  const due = effectiveDue(t);
  return {
    id: t.id,
    ref: ticketRef(t.id, t.prefix ?? t.type),
    title: t.title,
    description: t.description,
    type: t.type,
    status: t.status,
    priority: t.priority,
    impact: t.impact,
    urgency: t.urgency,
    source: t.source,
    requester: user(t.requester ?? null),
    assignee: user(t.assignee ?? null),
    category_id: t.categoryId,
    service_id: t.serviceId,
    group_id: t.groupId ?? null,
    problem_id: t.problemId ?? null,
    change_id: t.changeId ?? null,
    import_ref: t.importRef ?? null,
    // Monitoring dedup key; `external_ref_open` = this is the open ticket that new alerts with the key land in.
    external_ref: t.externalRef ?? null,
    external_ref_open: !!t.openExternalRef,
    // The manual due date when an agent set one, else the SLA resolution deadline; `due_at_source` says which.
    due_at: due.at?.toISOString() ?? null,
    due_at_source: due.source,
    sla_due_at: (t.resolveDueAt ?? t.dueAt)?.toISOString() ?? null,
    resolved_at: t.resolvedAt?.toISOString() ?? null,
    created_at: t.createdAt.toISOString(),
    updated_at: t.updatedAt.toISOString(),
  };
}

/** Relations loaded for an asset by the /assets endpoints. */
export const ASSET_INCLUDE = {
  owner: true,
  group: { select: { id: true, name: true } },
  locationRef: { select: { id: true, name: true } },
} as const;

export function serializeAsset(a: {
  id: string;
  assetTag: string | null;
  name: string;
  type: string;
  status: string;
  serial: string | null;
  model: string | null;
  manufacturer: string | null;
  location: string | null;
  ipAddress: string | null;
  os: string | null;
  owner?: Userish;
  macAddress?: string | null;
  cpu?: string | null;
  ramGb?: number | null;
  storageGb?: number | null;
  cost?: number | null;
  purchaseDate?: Date | null;
  warrantyEnd?: Date | null;
  notes?: string | null;
  group?: { id: string; name: string } | null;
  locationRef?: { id: string; name: string } | null;
  externalId?: string | null;
  importRef?: string | null;
  lastSeenAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  const day = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);
  return {
    id: a.id,
    asset_tag: a.assetTag,
    name: a.name,
    type: a.type,
    status: a.status,
    serial: a.serial,
    model: a.model,
    manufacturer: a.manufacturer,
    location: a.location,
    location_ref: a.locationRef ? { id: a.locationRef.id, name: a.locationRef.name } : null,
    ip_address: a.ipAddress,
    mac_address: a.macAddress ?? null,
    os: a.os,
    cpu: a.cpu ?? null,
    ram_gb: a.ramGb ?? null,
    storage_gb: a.storageGb ?? null,
    cost: a.cost ?? null,
    purchase_date: day(a.purchaseDate),
    warranty_end: day(a.warrantyEnd),
    notes: a.notes ?? null,
    owner: user(a.owner ?? null),
    group: a.group ? { id: a.group.id, name: a.group.name } : null,
    external_id: a.externalId ?? null,
    import_ref: a.importRef ?? null,
    last_seen_at: a.lastSeenAt?.toISOString() ?? null,
    created_at: a.createdAt.toISOString(),
    updated_at: a.updatedAt.toISOString(),
  };
}

export function serializeAssetRelation(r: { id: string; type: string; sourceId: string; targetId: string; source?: { id: string; name: string; type: string }; target?: { id: string; name: string; type: string } }, assetId: string) {
  const outgoing = r.sourceId === assetId;
  const other = outgoing ? r.target : r.source;
  return {
    id: r.id,
    type: r.type,
    direction: outgoing ? "outgoing" : "incoming",
    source_id: r.sourceId,
    target_id: r.targetId,
    other: other ? { id: other.id, name: other.name, type: other.type } : null,
  };
}

export function serializeVendor(v: { id: string; name: string; website: string | null; email: string | null; phone: string | null; notes: string | null; isActive: boolean; importRef: string | null; createdAt: Date; updatedAt: Date }) {
  return { id: v.id, name: v.name, website: v.website, email: v.email, phone: v.phone, notes: v.notes, active: v.isActive, import_ref: v.importRef, created_at: v.createdAt.toISOString(), updated_at: v.updatedAt.toISOString() };
}

export const LICENSE_INCLUDE = {
  vendor: { select: { id: true, name: true } },
  owner: true,
  assignments: { include: { user: true, asset: { select: { id: true, name: true } } }, orderBy: { assignedAt: "asc" } },
} as const;

export function serializeLicense(l: {
  id: string; name: string; licenseType: string; seats: number; expiresAt: Date | null; cost: number | null; notes: string | null;
  vendorId: string | null; contractId: string | null; createdAt: Date; updatedAt: Date;
  vendor?: { id: string; name: string } | null; owner?: Userish;
  assignments?: { id: string; assignedAt: Date; user: Userish; asset: { id: string; name: string } | null }[];
}) {
  const assignments = l.assignments ?? [];
  return {
    id: l.id,
    name: l.name,
    license_type: l.licenseType,
    seats: l.seats,
    used_seats: assignments.length,
    over_allocated: assignments.length > l.seats,
    expires_at: l.expiresAt ? l.expiresAt.toISOString().slice(0, 10) : null,
    cost: l.cost,
    notes: l.notes,
    vendor: l.vendor ? { id: l.vendor.id, name: l.vendor.name } : null,
    contract_id: l.contractId,
    owner: user(l.owner ?? null),
    assignments: assignments.map((a) => ({ id: a.id, assigned_at: a.assignedAt.toISOString(), user: user(a.user), asset: a.asset ? { id: a.asset.id, name: a.asset.name } : null })),
    created_at: l.createdAt.toISOString(),
    updated_at: l.updatedAt.toISOString(),
  };
}

const iso = (d: Date | null | undefined) => d?.toISOString() ?? null;
type Named = { id: string; name: string } | null | undefined;
const named = (n: Named) => (n ? { id: n.id, name: n.name } : null);

/** Relations loaded for a change by the /changes endpoints. */
export const CHANGE_INCLUDE = {
  assignee: true,
  createdBy: true,
  group: { select: { id: true, name: true } },
  category: { select: { id: true, name: true } },
  approvals: { include: { approver: true }, orderBy: { createdAt: "asc" } },
  assets: { include: { asset: { select: { id: true, name: true, type: true } } } },
  _count: { select: { comments: true } },
} as const;

export function serializeChange(c: {
  id: number; title: string; description: string; type: string; status: string; risk: string;
  priority: string; impact: string; reason: string | null; implementationPlan: string | null;
  rollbackPlan: string | null; outcome: string | null; closureNotes: string | null; cancelReason: string | null;
  customFields: string; problemId: number | null; releaseId: number | null; templateId: string | null;
  plannedStart: Date | null; plannedEnd: Date | null; actualStart: Date | null; actualEnd: Date | null;
  createdAt: Date; updatedAt: Date; importRef?: string | null;
  assignee?: Userish; createdBy?: Userish; group?: Named; category?: Named;
  approvals?: { id: string; status: string; comment: string | null; decidedAt: Date | null; approver: Userish }[];
  assets?: { asset: { id: string; name: string; type: string } }[];
  _count?: { comments: number };
}) {
  return {
    id: c.id,
    ref: changeRef(c.id),
    title: c.title,
    description: c.description,
    type: c.type,
    status: c.status,
    risk: c.risk,
    priority: c.priority,
    impact: c.impact,
    reason: c.reason,
    implementation_plan: c.implementationPlan,
    rollback_plan: c.rollbackPlan,
    outcome: c.outcome,
    closure_notes: c.closureNotes,
    cancel_reason: c.cancelReason,
    custom_fields: parseCustomFields(c.customFields),
    assignee: user(c.assignee ?? null),
    created_by: user(c.createdBy ?? null),
    group: named(c.group),
    category: named(c.category),
    problem_id: c.problemId,
    release_id: c.releaseId,
    template_id: c.templateId,
    import_ref: c.importRef ?? null,
    approvals: (c.approvals ?? []).map((a) => ({
      id: a.id, status: a.status, comment: a.comment, decided_at: iso(a.decidedAt), approver: user(a.approver),
    })),
    assets: (c.assets ?? []).map(({ asset }) => ({ id: asset.id, name: asset.name, type: asset.type })),
    comment_count: c._count?.comments ?? null,
    planned_start: iso(c.plannedStart),
    planned_end: iso(c.plannedEnd),
    actual_start: iso(c.actualStart),
    actual_end: iso(c.actualEnd),
    created_at: c.createdAt.toISOString(),
    updated_at: c.updatedAt.toISOString(),
  };
}

/** Relations loaded for a problem by the /problems endpoints. */
export const PROBLEM_INCLUDE = {
  assignee: true,
  group: { select: { id: true, name: true } },
  category: { select: { id: true, name: true } },
  tickets: { select: { id: true, prefix: true, type: true, title: true, status: true } },
  changes: { select: { id: true, title: true, status: true } },
  _count: { select: { comments: true } },
} as const;

export function serializeProblem(p: {
  id: number; title: string; description: string; status: string; priority: string; impact: string;
  rootCause: string | null; workaround: string | null; customFields: string;
  createdAt: Date; updatedAt: Date; resolvedAt: Date | null; importRef?: string | null;
  assignee?: Userish; group?: Named; category?: Named;
  tickets?: { id: number; prefix: string | null; type: string; title: string; status: string }[];
  changes?: { id: number; title: string; status: string }[];
  _count?: { comments: number };
}) {
  return {
    id: p.id,
    ref: problemRef(p.id),
    title: p.title,
    description: p.description,
    status: p.status,
    priority: p.priority,
    impact: p.impact,
    root_cause: p.rootCause,
    workaround: p.workaround,
    custom_fields: parseCustomFields(p.customFields),
    assignee: user(p.assignee ?? null),
    group: named(p.group),
    category: named(p.category),
    tickets: (p.tickets ?? []).map((t) => ({ id: t.id, ref: ticketRef(t.id, t.prefix ?? t.type), title: t.title, status: t.status })),
    changes: (p.changes ?? []).map((c) => ({ id: c.id, ref: changeRef(c.id), title: c.title, status: c.status })),
    comment_count: p._count?.comments ?? null,
    import_ref: p.importRef ?? null,
    resolved_at: iso(p.resolvedAt),
    created_at: p.createdAt.toISOString(),
    updated_at: p.updatedAt.toISOString(),
  };
}

export function serializeComment(c: {
  id: string; body: string; bodyHtml: string | null; isInternal: boolean; createdAt: Date; author?: Userish; channel?: string;
  importRef?: string | null;
}) {
  return {
    id: c.id,
    body: c.body,
    body_html: c.bodyHtml,
    internal: c.isInternal,
    ...(c.channel ? { channel: c.channel } : {}),
    // Only on comments written by the history import with a source id.
    ...(c.importRef ? { import_ref: c.importRef } : {}),
    author: user(c.author ?? null),
    created_at: c.createdAt.toISOString(),
  };
}

function parseCustomFields(raw: string): Record<string, unknown> {
  try {
    const v = JSON.parse(raw || "{}");
    return v && typeof v === "object" && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}

export function serializeRecurringTicket(r: {
  id: string; name: string; isActive: boolean; title: string; description: string; type: string; priority: string;
  impact: string; urgency: string; requesterId: string | null; assigneeId: string | null; groupId: string | null;
  categoryId: string | null; serviceId: string | null; frequency: string; interval: number; timezone: string;
  firstDueAt: Date; createBeforeDays: number; nextDueAt: Date; lastCreatedFor: Date | null; lastTicketId: number | null;
  lastError: string | null; importRef: string | null; createdById: string | null; createdAt: Date; updatedAt: Date;
}, nextCreateAt: Date) {
  return {
    id: r.id,
    name: r.name,
    active: r.isActive,
    title: r.title,
    description: r.description,
    type: r.type,
    priority: r.priority,
    impact: r.impact,
    urgency: r.urgency,
    requester_id: r.requesterId,
    assignee_id: r.assigneeId,
    group_id: r.groupId,
    category_id: r.categoryId,
    service_id: r.serviceId,
    frequency: r.frequency,
    interval: r.interval,
    timezone: r.timezone,
    first_due_at: r.firstDueAt.toISOString(),
    create_before_days: r.createBeforeDays,
    next_due_at: r.nextDueAt.toISOString(),
    next_create_at: nextCreateAt.toISOString(),
    last_created_for: r.lastCreatedFor?.toISOString() ?? null,
    last_ticket_id: r.lastTicketId,
    last_error: r.lastError,
    import_ref: r.importRef,
    created_by_id: r.createdById,
    created_at: r.createdAt.toISOString(),
    updated_at: r.updatedAt.toISOString(),
  };
}

/** A schedule with its next creation time (`next_create_at`). */
export function presentRecurringTicket(r: Parameters<typeof serializeRecurringTicket>[0]) {
  return serializeRecurringTicket(r, creationTimeFor(recurrenceOf(r), r.nextDueAt));
}

/** A file on a ticket, change, problem, asset or license. Never exposes the storage key or path. */
export function serializeAttachment(
  a: { id: string; filename: string; mime: string; size: number; createdAt: Date; commentId: string | null; importRef?: string | null; uploadedBy?: Userish },
  downloadUrl: string,
) {
  return {
    id: a.id,
    filename: a.filename,
    content_type: a.mime,
    size: a.size,
    comment_id: a.commentId,
    import_ref: a.importRef ?? null,
    uploaded_by: user(a.uploadedBy ?? null),
    created_at: a.createdAt.toISOString(),
    download_url: downloadUrl,
  };
}
