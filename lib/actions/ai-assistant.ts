"use server";

import { db } from "@/lib/db";
import { getCurrentUser, isAgent, hasRole, type Role } from "@/lib/session";
import { runOperation } from "@/lib/ai-operations/tools";
import { AI_SCOPES, ticketRef, problemRef, changeRef } from "@/lib/constants";
import { loadAccessibleProject, canManageProjectRow } from "@/lib/ai-projects";
import {
  claimProposal,
  dismissProposal,
  markProposalApplied,
  proposalDecisions,
  proposalKey,
  releaseProposalClaim,
  type ProposalDecision,
} from "@/lib/ai-proposal-decisions";

/* ────────────────────────────────────────────────────────────────────────────
 * SHARED TYPES — defined once here, imported (type-only) everywhere else.
 * ──────────────────────────────────────────────────────────────────────────── */

export type AssistantScope = "GENERAL" | "ADMIN";

/**
 * An attachment as rendered in the transcript. `dataUrl` is present for images
 * (thumbnail preview). Files show a chip (name/size) with no data.
 */
export type AssistantAttachment = {
  name: string;
  type: string;
  size: number;
  kind: "image" | "file";
  dataUrl?: string;
};

/**
 * An attachment as the client uploads it: a data URL (base64) for every file so
 * the server can feed images to a vision model and extract text from documents.
 */
export type UploadedAttachment = {
  name: string;
  type: string;
  size: number;
  dataUrl: string;
};

/** A chat turn as the client holds it (mirrors ChatMessage but with render extras). */
export type AssistantMessage = {
  role: "user" | "assistant";
  content: string;
  html?: string;
  toolCalls?: { name: string; input: unknown }[];
  proposals?: AssistantProposal[];
  attachments?: AssistantAttachment[];
  reasoning?: string; // extended-thinking summary (session-only; not persisted)
  error?: boolean;
};

/**
 * A change Sable proposes via an operation from the RBAC registry
 * (`lib/ai-operations`). Nothing mutates until the human approves the card and
 * applyAssistantProposal re-checks the operation's role + chat scope, re-validates
 * the args against the operation's schema, and runs the real mutation.
 */
export type AssistantProposal = {
  id: string; // stable within a turn (pr0, pr1, …)
  operationId: string; // registry op id, e.g. "category.create"
  args: Record<string, unknown>;
  label: string; // human summary for the approval card
  toolCallId?: string; // the tool call that made it: one proposal, one decision
  decision?: ProposalDecision; // set on a reloaded transcript once the user applied or dismissed it
  // Stored after decisions were recorded server-side. Older proposals may have been applied
  // without a record, so only tracked ones are offered again on reload.
  decisionTracked?: boolean;
};

/** Left-rail list item. */
export type ConversationSummary = {
  id: string;
  title: string;
  scope: AssistantScope;
  archived: boolean;
  folderId: string | null;
  projectId: string | null;
  updatedAt: string; // ISO string (serialized for the client)
};

/** A folder in the left rail. */
export type AiFolderSummary = {
  id: string;
  name: string;
};

/** A Sable project as shown in the rail / switcher. `role` is the actor's relationship. */
export type ProjectSummary = {
  id: string;
  name: string;
  archived: boolean;
  isShared: boolean;
  groupId: string | null;
  role: "owner" | "member";
  changeId: number | null;
  problemId: number | null;
  ticketId: number | null;
  updatedAt: string; // ISO string
};

/** Full project for the project home pane (getProject). */
export type ProjectDetail = ProjectSummary & {
  description: string | null;
  instructions: string | null;
};

/** A searchable option for the project-links picker (mirrors the ticket LinkPicker). */
export type ProjectLinkOption = { value: string; label: string };
/** A currently-linked record, rendered as a chip. */
export type ProjectLinkRef = { id: number; label: string; href: string };
export type ProjectLinks = {
  current: { ticket: ProjectLinkRef | null; problem: ProjectLinkRef | null; change: ProjectLinkRef | null };
  options: { tickets: ProjectLinkOption[]; problems: ProjectLinkOption[]; changes: ProjectLinkOption[] };
};

/** Full conversation for the active-view (getConversation). */
export type ConversationDetail = {
  id: string;
  title: string;
  scope: AssistantScope;
  archived: boolean;
  messages: AssistantMessage[];
};

export type ApplyResult = { ok: boolean; applied?: string; error?: string };

/* ────────────────────────────────────────────────────────────────────────────
 * Helpers.
 * ──────────────────────────────────────────────────────────────────────────── */

/** Normalise a persisted scope string to the union (defence in depth). */
function coerceScope(raw: string): AssistantScope {
  return raw === "ADMIN" ? "ADMIN" : "GENERAL";
}

/**
 * The acting user with a FRESH role from the DB (not the possibly-stale JWT).
 * The Auth.js JWT freezes role/isActive at login (see lib/session.ts), so a
 * demoted or deactivated user would otherwise keep their old access until the
 * token expires. Every RBAC decision in this file authorises off this, never
 * the session role. Returns null if not signed in, inactive, or below AGENT.
 */
async function actingAgent(): Promise<
  { id: string; name: string; email: string; role: Role } | null
> {
  const row = await getCurrentUser();
  if (!row || !row.isActive || !isAgent(row.role as Role)) return null;
  return {
    id: row.id,
    name: row.name ?? row.email ?? "User",
    email: row.email ?? "",
    role: row.role as Role,
  };
}

/** Serialize an AiMessage row → AssistantMessage (parse the JSON columns). */
function toAssistantMessage(row: {
  role: string;
  content: string;
  html: string | null;
  toolCalls: string | null;
  proposals: string | null;
}): AssistantMessage {
  const msg: AssistantMessage = {
    role: row.role === "assistant" ? "assistant" : "user",
    content: row.content ?? "",
  };
  if (row.html) msg.html = row.html;
  if (row.toolCalls) {
    try {
      msg.toolCalls = JSON.parse(row.toolCalls) as { name: string; input: unknown }[];
    } catch {
      /* ignore malformed */
    }
  }
  if (row.proposals) {
    try {
      msg.proposals = JSON.parse(row.proposals) as AssistantProposal[];
    } catch {
      /* ignore malformed */
    }
  }
  return msg;
}

/* ────────────────────────────────────────────────────────────────────────────
 * Conversation CRUD.
 * ──────────────────────────────────────────────────────────────────────────── */

export async function listConversations(): Promise<ConversationSummary[]> {
  const me = await actingAgent();
  if (!me) return [];
  const admin = hasRole(me.role, "ADMIN");

  const rows = await db.aiConversation.findMany({
    where: { userId: me.id },
    orderBy: [{ archived: "asc" }, { updatedAt: "desc" }],
    select: { id: true, title: true, scope: true, archived: true, folderId: true, projectId: true, updatedAt: true },
  });

  return rows
    .filter((r) => admin || coerceScope(r.scope) !== "ADMIN") // defence in depth
    .map((r) => ({
      id: r.id,
      title: r.title,
      scope: coerceScope(r.scope),
      archived: r.archived,
      folderId: r.folderId,
      projectId: r.projectId,
      updatedAt: r.updatedAt.toISOString(),
    }));
}

/* ────────────────────────────────────────────────────────────────────────────
 * Folders — per-user grouping of conversations (left rail).
 * ──────────────────────────────────────────────────────────────────────────── */

export async function listFolders(): Promise<AiFolderSummary[]> {
  const me = await actingAgent();
  if (!me) return [];
  const rows = await db.aiFolder.findMany({
    where: { userId: me.id },
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true },
  });
  return rows;
}

export async function createFolder(
  name?: string,
): Promise<{ ok: true; folder: AiFolderSummary } | { ok: false; error: string }> {
  const me = await actingAgent();
  if (!me) return { ok: false, error: "Not authorised" };
  const trimmed = String(name ?? "").trim().slice(0, 80) || "New folder";
  const row = await db.aiFolder.create({
    data: { userId: me.id, name: trimmed },
    select: { id: true, name: true },
  });
  return { ok: true, folder: row };
}

export async function renameFolder(
  id: string,
  name: string,
): Promise<{ ok: boolean; error?: string }> {
  const me = await actingAgent();
  if (!me) return { ok: false, error: "Not authorised" };
  const row = await db.aiFolder.findUnique({ where: { id }, select: { userId: true } });
  if (!row || row.userId !== me.id) return { ok: false, error: "Not authorised" };
  const trimmed = String(name ?? "").trim().slice(0, 80) || "New folder";
  await db.aiFolder.update({ where: { id }, data: { name: trimmed } });
  return { ok: true };
}

/** Delete a folder. Its conversations are un-grouped (SetNull), never deleted. */
export async function deleteFolder(id: string): Promise<{ ok: boolean; error?: string }> {
  const me = await actingAgent();
  if (!me) return { ok: false, error: "Not authorised" };
  const row = await db.aiFolder.findUnique({ where: { id }, select: { userId: true } });
  if (!row || row.userId !== me.id) return { ok: false, error: "Not authorised" };
  await db.aiFolder.delete({ where: { id } });
  return { ok: true };
}

/** Move a conversation into a folder (or out of any folder when folderId is null). */
export async function moveConversation(
  conversationId: string,
  folderId: string | null,
): Promise<{ ok: boolean; error?: string }> {
  const me = await actingAgent();
  if (!me) return { ok: false, error: "Not authorised" };

  const conv = await db.aiConversation.findUnique({
    where: { id: conversationId },
    select: { userId: true },
  });
  if (!conv || conv.userId !== me.id) return { ok: false, error: "Not authorised" };

  if (folderId) {
    const folder = await db.aiFolder.findUnique({ where: { id: folderId }, select: { userId: true } });
    if (!folder || folder.userId !== me.id) return { ok: false, error: "Not authorised" };
  }

  // Folders and projects are mutually-exclusive grouping axes — moving a chat into
  // (or out of) a folder clears any project pin, so it never lives in both.
  await db.aiConversation.update({ where: { id: conversationId }, data: { folderId, projectId: null } });
  return { ok: true };
}

export async function createConversation(
  scope: AssistantScope,
  projectId?: string | null,
): Promise<
  { ok: true; conversation: ConversationSummary } | { ok: false; error: string }
> {
  const me = await actingAgent();
  if (!me) return { ok: false, error: "Not authorised" };
  if (!AI_SCOPES.includes(scope)) return { ok: false, error: "Invalid scope" };
  if (scope === "ADMIN" && !hasRole(me.role, "ADMIN")) {
    return { ok: false, error: "Not authorised" };
  }

  // If pinned to a project, the actor must be able to access it.
  if (projectId) {
    const p = await loadAccessibleProject(me, projectId);
    if (!p) return { ok: false, error: "Not authorised" };
  }

  const row = await db.aiConversation.create({
    data: { userId: me.id, scope, title: "New chat", projectId: projectId ?? null },
    select: { id: true, title: true, scope: true, archived: true, folderId: true, projectId: true, updatedAt: true },
  });

  return {
    ok: true,
    conversation: {
      id: row.id,
      title: row.title,
      scope: coerceScope(row.scope),
      archived: row.archived,
      folderId: row.folderId,
      projectId: row.projectId,
      updatedAt: row.updatedAt.toISOString(),
    },
  };
}

export async function getConversation(
  id: string,
): Promise<
  { ok: true; conversation: ConversationDetail } | { ok: false; error: string }
> {
  const me = await actingAgent();
  if (!me) return { ok: false, error: "Not authorised" };

  const row = await db.aiConversation.findUnique({
    where: { id },
    select: {
      id: true,
      userId: true,
      title: true,
      scope: true,
      archived: true,
      messages: {
        orderBy: { createdAt: "asc" },
        select: {
          role: true,
          content: true,
          html: true,
          toolCalls: true,
          proposals: true,
        },
      },
    },
  });

  if (!row || row.userId !== me.id) return { ok: false, error: "Not authorised" };
  const scope = coerceScope(row.scope);
  if (scope === "ADMIN" && !hasRole(me.role, "ADMIN")) {
    return { ok: false, error: "Not authorised" };
  }

  const decisions = await proposalDecisions(row.id);
  const withDecision = (p: AssistantProposal): AssistantProposal => {
    const decision = decisions.get(proposalKey(p));
    return decision ? { ...p, decision } : p;
  };

  return {
    ok: true,
    conversation: {
      id: row.id,
      title: row.title,
      scope,
      archived: row.archived,
      messages: row.messages.map(toAssistantMessage).map((m) =>
        m.proposals ? { ...m, proposals: m.proposals.map(withDecision) } : m,
      ),
    },
  };
}

export async function renameConversation(
  id: string,
  title: string,
): Promise<{ ok: boolean; error?: string }> {
  const me = await actingAgent();
  if (!me) return { ok: false, error: "Not authorised" };

  const row = await db.aiConversation.findUnique({
    where: { id },
    select: { userId: true },
  });
  if (!row || row.userId !== me.id) return { ok: false, error: "Not authorised" };

  const trimmed = String(title ?? "").trim().slice(0, 120);
  await db.aiConversation.update({
    where: { id },
    data: { title: trimmed || "New chat" },
  });
  return { ok: true };
}

export async function archiveConversation(
  id: string,
  archived: boolean,
): Promise<{ ok: boolean; error?: string }> {
  const me = await actingAgent();
  if (!me) return { ok: false, error: "Not authorised" };

  const row = await db.aiConversation.findUnique({
    where: { id },
    select: { userId: true },
  });
  if (!row || row.userId !== me.id) return { ok: false, error: "Not authorised" };

  await db.aiConversation.update({ where: { id }, data: { archived: Boolean(archived) } });
  return { ok: true };
}

/** Permanently delete a conversation and its messages (owner only). */
export async function deleteConversation(id: string): Promise<{ ok: boolean; error?: string }> {
  const me = await actingAgent();
  if (!me) return { ok: false, error: "Not authorised" };

  const row = await db.aiConversation.findUnique({
    where: { id },
    select: { userId: true },
  });
  if (!row || row.userId !== me.id) return { ok: false, error: "Not authorised" };

  await db.aiConversation.delete({ where: { id } }); // AiMessage cascades
  return { ok: true };
}

/* ────────────────────────────────────────────────────────────────────────────
 * Projects — persistent Sable workspaces (conversations + file library +
 * custom instructions + optional ITSM binding). Owner-managed; optionally
 * shared with one team. Access is enforced via lib/ai-projects.ts.
 * ──────────────────────────────────────────────────────────────────────────── */

type ProjectRow = {
  id: string;
  userId: string;
  name: string;
  archived: boolean;
  isShared: boolean;
  groupId: string | null;
  changeId: number | null;
  problemId: number | null;
  ticketId: number | null;
  updatedAt: Date;
};

const PROJECT_SELECT = {
  id: true, userId: true, name: true, archived: true,
  isShared: true, groupId: true, changeId: true, problemId: true, ticketId: true, updatedAt: true,
} as const;

function toProjectSummary(row: ProjectRow, meId: string): ProjectSummary {
  return {
    id: row.id,
    name: row.name,
    archived: row.archived,
    isShared: row.isShared,
    groupId: row.groupId,
    role: row.userId === meId ? "owner" : "member",
    changeId: row.changeId,
    problemId: row.problemId,
    ticketId: row.ticketId,
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** All projects the actor can see: their own + shared projects for their teams. */
export async function listProjects(): Promise<ProjectSummary[]> {
  const me = await actingAgent();
  if (!me) return [];
  const memberships = await db.groupMember.findMany({
    where: { userId: me.id },
    select: { groupId: true },
  });
  const groupIds = memberships.map((m) => m.groupId);
  const rows = await db.aiProject.findMany({
    where: { OR: [{ userId: me.id }, { isShared: true, groupId: { in: groupIds } }] },
    orderBy: [{ archived: "asc" }, { updatedAt: "desc" }],
    select: PROJECT_SELECT,
  });
  return rows.map((r) => toProjectSummary(r, me.id));
}

export async function getProject(
  id: string,
): Promise<{ ok: true; project: ProjectDetail } | { ok: false; error: string }> {
  const me = await actingAgent();
  if (!me) return { ok: false, error: "Not authorised" };
  const row = await db.aiProject.findUnique({
    where: { id },
    select: { ...PROJECT_SELECT, description: true, instructions: true },
  });
  if (!row) return { ok: false, error: "Not found" };
  const access = await loadAccessibleProject(me, id);
  if (!access) return { ok: false, error: "Not authorised" };
  return {
    ok: true,
    project: {
      ...toProjectSummary(row, me.id),
      description: row.description,
      instructions: row.instructions,
    },
  };
}

export async function createProject(
  name?: string,
): Promise<{ ok: true; project: ProjectSummary } | { ok: false; error: string }> {
  const me = await actingAgent();
  if (!me) return { ok: false, error: "Not authorised" };
  const trimmed = String(name ?? "").trim().slice(0, 80) || "New project";
  const row = await db.aiProject.create({
    data: { userId: me.id, name: trimmed },
    select: PROJECT_SELECT,
  });
  return { ok: true, project: toProjectSummary(row, me.id) };
}

/** Guard: the actor owns the project (manage rights). Returns the row or an error. */
async function requireManagedProject(
  meId: string,
  id: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const row = await db.aiProject.findUnique({
    where: { id },
    select: { userId: true, isShared: true, groupId: true },
  });
  if (!row) return { ok: false, error: "Not found" };
  if (!canManageProjectRow({ id: meId, role: "AGENT" }, row)) return { ok: false, error: "Not authorised" };
  return { ok: true };
}

export async function renameProject(id: string, name: string): Promise<{ ok: boolean; error?: string }> {
  const me = await actingAgent();
  if (!me) return { ok: false, error: "Not authorised" };
  const guard = await requireManagedProject(me.id, id);
  if (!guard.ok) return guard;
  const trimmed = String(name ?? "").trim().slice(0, 80) || "New project";
  await db.aiProject.update({ where: { id }, data: { name: trimmed } });
  return { ok: true };
}

export async function updateProjectInstructions(
  id: string,
  instructions: string,
): Promise<{ ok: boolean; error?: string }> {
  const me = await actingAgent();
  if (!me) return { ok: false, error: "Not authorised" };
  const guard = await requireManagedProject(me.id, id);
  if (!guard.ok) return guard;
  const trimmed = String(instructions ?? "").slice(0, 4000);
  await db.aiProject.update({ where: { id }, data: { instructions: trimmed || null } });
  return { ok: true };
}

/**
 * Bind the project to an ITSM entity (Change / Problem / Ticket). Pass a value to
 * set, `null` to clear that binding, or omit a key to leave it unchanged. Each id
 * is verified to exist before it is stored.
 */
export async function updateProjectBinding(
  id: string,
  binding: { changeId?: number | null; problemId?: number | null; ticketId?: number | null },
): Promise<{ ok: boolean; error?: string }> {
  const me = await actingAgent();
  if (!me) return { ok: false, error: "Not authorised" };
  const guard = await requireManagedProject(me.id, id);
  if (!guard.ok) return guard;

  const data: { changeId?: number | null; problemId?: number | null; ticketId?: number | null } = {};

  if ("changeId" in binding) {
    const v = binding.changeId;
    if (v == null) data.changeId = null;
    else {
      const exists = await db.change.findUnique({ where: { id: Number(v) }, select: { id: true } });
      if (!exists) return { ok: false, error: "Change not found" };
      data.changeId = Number(v);
    }
  }
  if ("problemId" in binding) {
    const v = binding.problemId;
    if (v == null) data.problemId = null;
    else {
      const exists = await db.problem.findUnique({ where: { id: Number(v) }, select: { id: true } });
      if (!exists) return { ok: false, error: "Problem not found" };
      data.problemId = Number(v);
    }
  }
  if ("ticketId" in binding) {
    const v = binding.ticketId;
    if (v == null) data.ticketId = null;
    else {
      const exists = await db.ticket.findUnique({ where: { id: Number(v) }, select: { id: true } });
      if (!exists) return { ok: false, error: "Ticket not found" };
      data.ticketId = Number(v);
    }
  }

  await db.aiProject.update({ where: { id }, data });
  return { ok: true };
}

/**
 * Share (or un-share) the project with one team. Sharing requires the owner to be
 * a member of that team. Clearing (isShared=false) leaves the groupId untouched
 * but hides it from members.
 */
export async function shareProject(
  id: string,
  input: { isShared: boolean; groupId?: string | null },
): Promise<{ ok: boolean; error?: string }> {
  const me = await actingAgent();
  if (!me) return { ok: false, error: "Not authorised" };
  const guard = await requireManagedProject(me.id, id);
  if (!guard.ok) return guard;

  if (input.isShared) {
    const groupId = input.groupId ?? null;
    if (!groupId) return { ok: false, error: "Pick a team to share with" };
    const member = await db.groupMember.findFirst({
      where: { userId: me.id, groupId },
      select: { userId: true },
    });
    if (!member) return { ok: false, error: "You are not a member of that team" };
    await db.aiProject.update({ where: { id }, data: { isShared: true, groupId } });
  } else {
    await db.aiProject.update({ where: { id }, data: { isShared: false } });
  }
  return { ok: true };
}

/** The actor's teams — used to populate the project Share picker (owner shares with one team). */
export type TeamSummary = { id: string; name: string };

export async function listMyTeams(): Promise<TeamSummary[]> {
  const me = await actingAgent();
  if (!me) return [];
  const rows = await db.groupMember.findMany({
    where: { userId: me.id },
    orderBy: { group: { name: "asc" } },
    select: { group: { select: { id: true, name: true } } },
  });
  return rows.map((r) => ({ id: r.group.id, name: r.group.name }));
}

/** Delete a project. Files + folders cascade; conversations are un-pinned (SetNull). */
export async function deleteProject(id: string): Promise<{ ok: boolean; error?: string }> {
  const me = await actingAgent();
  if (!me) return { ok: false, error: "Not authorised" };
  const guard = await requireManagedProject(me.id, id);
  if (!guard.ok) return guard;
  await db.aiProject.delete({ where: { id } });
  return { ok: true };
}

/** Archive or restore a project (owner only). Archived projects hide from the rail. */
export async function archiveProject(id: string, archived: boolean): Promise<{ ok: boolean; error?: string }> {
  const me = await actingAgent();
  if (!me) return { ok: false, error: "Not authorised" };
  const guard = await requireManagedProject(me.id, id);
  if (!guard.ok) return guard;
  await db.aiProject.update({ where: { id }, data: { archived: Boolean(archived) } });
  return { ok: true };
}

/** Pin one of the actor's own conversations to a project (or unpin when null). */
export async function moveConversationToProject(
  conversationId: string,
  projectId: string | null,
): Promise<{ ok: boolean; error?: string }> {
  const me = await actingAgent();
  if (!me) return { ok: false, error: "Not authorised" };

  const conv = await db.aiConversation.findUnique({
    where: { id: conversationId },
    select: { userId: true },
  });
  if (!conv || conv.userId !== me.id) return { ok: false, error: "Not authorised" };

  if (projectId) {
    const access = await loadAccessibleProject(me, projectId);
    if (!access) return { ok: false, error: "Not authorised" };
  }

  // Pinning to a project clears any folder — a chat belongs to one grouping (project
  // or folder), mirroring how moveConversation clears the project.
  await db.aiConversation.update({ where: { id: conversationId }, data: { projectId, folderId: null } });
  return { ok: true };
}

/**
 * Options + current links for the project-links picker — the same shape the ticket
 * page feeds its LinkPicker (searchable Combobox over a bounded, recent list).
 */
export async function getProjectLinks(
  projectId: string,
): Promise<{ ok: true; links: ProjectLinks } | { ok: false; error: string }> {
  const me = await actingAgent();
  if (!me) return { ok: false, error: "Not authorised" };
  const access = await loadAccessibleProject(me, projectId);
  if (!access) return { ok: false, error: "Not authorised" };

  const p = await db.aiProject.findUnique({
    where: { id: projectId },
    select: { ticketId: true, problemId: true, changeId: true },
  });
  if (!p) return { ok: false, error: "Not found" };

  // Option lists mirror the ticket page's LinkPicker exactly: active records only,
  // agent-readable (Servio has no per-agent ticket/problem/change visibility — this
  // action is already AGENT+ and project-access gated, and returns the same data the
  // caller can read on /tickets etc.). No per-tenant scoping exists in this app.
  const [tickets, problems, changes, curTicket, curProblem, curChange] = await Promise.all([
    db.ticket.findMany({ where: { status: { notIn: ["CLOSED", "CANCELLED"] } }, orderBy: { updatedAt: "desc" }, take: 60, select: { id: true, title: true, prefix: true } }),
    db.problem.findMany({ where: { status: { notIn: ["RESOLVED", "CLOSED"] } }, orderBy: { updatedAt: "desc" }, take: 100, select: { id: true, title: true } }),
    db.change.findMany({ where: { status: { notIn: ["CLOSED", "REJECTED", "FAILED"] } }, orderBy: { updatedAt: "desc" }, take: 100, select: { id: true, title: true } }),
    p.ticketId ? db.ticket.findUnique({ where: { id: p.ticketId }, select: { id: true, title: true, prefix: true } }) : Promise.resolve(null),
    p.problemId ? db.problem.findUnique({ where: { id: p.problemId }, select: { id: true, title: true } }) : Promise.resolve(null),
    p.changeId ? db.change.findUnique({ where: { id: p.changeId }, select: { id: true, title: true } }) : Promise.resolve(null),
  ]);

  return {
    ok: true,
    links: {
      current: {
        ticket: curTicket ? { id: curTicket.id, label: `${ticketRef(curTicket.id, curTicket.prefix)} · ${curTicket.title}`, href: `/tickets/${curTicket.id}` } : null,
        problem: curProblem ? { id: curProblem.id, label: `${problemRef(curProblem.id)} · ${curProblem.title}`, href: `/problems/${curProblem.id}` } : null,
        change: curChange ? { id: curChange.id, label: `${changeRef(curChange.id)} · ${curChange.title}`, href: `/changes/${curChange.id}` } : null,
      },
      options: {
        tickets: tickets.map((t) => ({ value: String(t.id), label: `${ticketRef(t.id, t.prefix)} · ${t.title}` })),
        problems: problems.map((pr) => ({ value: String(pr.id), label: `${problemRef(pr.id)} · ${pr.title}` })),
        changes: changes.map((c) => ({ value: String(c.id), label: `${changeRef(c.id)} · ${c.title}` })),
      },
    },
  };
}

/* ────────────────────────────────────────────────────────────────────────────
 * applyAssistantProposal — re-validate EVERYTHING server-side, run real actions.
 * ──────────────────────────────────────────────────────────────────────────── */

export async function applyAssistantProposal(input: {
  conversationId: string;
  proposal: AssistantProposal;
}): Promise<ApplyResult> {
  const me = await actingAgent();
  if (!me) return { ok: false, error: "Not authorised" };

  const p = input?.proposal;
  if (!p || typeof p !== "object" || typeof p.operationId !== "string") {
    return { ok: false, error: "Bad proposal" };
  }

  // Ownership of the conversation.
  const conv = await db.aiConversation.findUnique({
    where: { id: input.conversationId },
    select: { userId: true, scope: true, projectId: true },
  });
  if (!conv || conv.userId !== me.id) return { ok: false, error: "Not authorised" };

  // If the conversation is bound to a project the acting user can still access,
  // thread its id so project ops (e.g. project.file_delete) target the right library.
  let projectId: string | undefined;
  if (conv.projectId) {
    const access = await loadAccessibleProject({ id: me.id, role: me.role }, conv.projectId);
    if (access) projectId = conv.projectId;
  }

  // Generic dispatch: runOperation re-looks-up the operation, re-checks its
  // minRole against the FRESH DB role (actingAgent), enforces adminOnly against
  // the conversation's scope, re-validates the args against the op's schema
  // (client args are never trusted), then runs the real mutation.
  // Once the turn is stored, apply what Sable actually proposed, not what the client sent.
  const stored = p.toolCallId ? await storedProposal(input.conversationId, p.toolCallId) : null;
  const target: AssistantProposal = stored ?? p;

  // Claim before running, so a double click, a second tab or a reloaded card
  // cannot apply the same proposal twice; a refused or failed run gives it back.
  const key = proposalKey(target);
  const claim = await claimProposal(input.conversationId, key, me.id);
  if (!claim.claimed) {
    // Approving an already-applied proposal is a no-op that reports the original result.
    return claim.appliedSummary !== undefined
      ? { ok: true, applied: claim.appliedSummary }
      : { ok: false, error: claim.reason };
  }

  let res: Awaited<ReturnType<typeof runOperation>>;
  try {
    res = await runOperation({
      operationId: target.operationId,
      args: target.args,
      ctx: { userId: me.id, role: me.role, name: me.name, projectId },
      scope: coerceScope(conv.scope),
    });
  } catch (e) {
    await releaseProposalClaim(input.conversationId, key, claim.claimId);
    return { ok: false, error: e instanceof Error ? e.message : "Could not apply the change" };
  }
  if (!res.ok) {
    await releaseProposalClaim(input.conversationId, key, claim.claimId);
    return { ok: false, error: res.error };
  }

  // The change is made: never release the claim from here on. Failing to record
  // it leaves an APPLYING row, which blocks a retry; a second apply would be worse.
  try {
    await markProposalApplied(input.conversationId, key, claim.claimId, res.summary);
  } catch (e) {
    console.error("[sable] applied proposal could not be recorded", e);
  }
  return { ok: true, applied: res.summary };
}

/** The proposal a stored turn of this conversation made with this tool call, if the turn is stored yet. */
async function storedProposal(conversationId: string, toolCallId: string): Promise<AssistantProposal | null> {
  const rows = await db.aiMessage.findMany({
    where: { conversationId, role: "assistant", proposals: { contains: toolCallId } },
    // Newest first: should an upstream model ever reuse a call id, the latest turn wins.
    orderBy: { createdAt: "desc" },
    select: { proposals: true },
  });
  for (const row of rows) {
    const found = toAssistantMessage({ role: "assistant", content: "", html: null, toolCalls: null, proposals: row.proposals })
      .proposals?.find((p) => p.toolCallId === toolCallId);
    if (found) return found;
  }
  return null;
}

/** Dismiss a proposal for good, so a reloaded chat no longer offers it. */
export async function dismissAssistantProposal(input: {
  conversationId: string;
  proposal: AssistantProposal;
}): Promise<{ ok: boolean; error?: string }> {
  const me = await actingAgent();
  if (!me) return { ok: false, error: "Not authorised" };
  const p = input?.proposal;
  if (!p || typeof p.operationId !== "string") return { ok: false, error: "Bad proposal" };

  const conv = await db.aiConversation.findUnique({ where: { id: input.conversationId }, select: { userId: true } });
  if (!conv || conv.userId !== me.id) return { ok: false, error: "Not authorised" };

  const res = await dismissProposal(input.conversationId, proposalKey(p), me.id);
  if (res.dismissed) return { ok: true };
  return {
    ok: false,
    error: res.status === "APPLIED" ? "This proposal has already been applied." : "This proposal is being applied.",
  };
}
