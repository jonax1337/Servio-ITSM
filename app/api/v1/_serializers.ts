import { changeRef, problemRef, ticketRef } from "@/lib/constants";

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
  problemId?: number | null;
  changeId?: number | null;
  importRef?: string | null;
  dueAt: Date | null;
  resolvedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}) {
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
    problem_id: t.problemId ?? null,
    change_id: t.changeId ?? null,
    import_ref: t.importRef ?? null,
    due_at: t.dueAt?.toISOString() ?? null,
    resolved_at: t.resolvedAt?.toISOString() ?? null,
    created_at: t.createdAt.toISOString(),
    updated_at: t.updatedAt.toISOString(),
  };
}

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
  createdAt: Date;
  updatedAt: Date;
}) {
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
    ip_address: a.ipAddress,
    os: a.os,
    owner: user(a.owner ?? null),
    created_at: a.createdAt.toISOString(),
    updated_at: a.updatedAt.toISOString(),
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

export function serializeComment(c: { id: string; body: string; bodyHtml: string | null; isInternal: boolean; createdAt: Date; author?: Userish; channel?: string }) {
  return {
    id: c.id,
    body: c.body,
    body_html: c.bodyHtml,
    internal: c.isInternal,
    ...(c.channel ? { channel: c.channel } : {}),
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
