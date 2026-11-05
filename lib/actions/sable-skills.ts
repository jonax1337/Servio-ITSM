"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getCurrentUser, hasRole, type Role } from "@/lib/session";
import { setSetting } from "@/lib/settings";
import { writeAudit } from "@/lib/audit";
import type { ActionResult } from "@/lib/action-result";
import { AI_ASSISTANT_NAME } from "@/lib/constants";
import {
  parseSkillMarkdown,
  SKILL_BODY_MAX,
  SKILL_DESCRIPTION_MAX,
  validateSkill,
  type SableSkillInput,
} from "@/lib/sable-skills";
import {
  DISABLED_SKILLS_SETTING,
  getDisabledBuiltinSkills,
  invalidateSableWorkspace,
  readBuiltinSkills,
} from "@/lib/sable-workspace";

const SETTINGS_PATH = "/settings/ai";
/** Room for the frontmatter around the longest valid body and description. */
const IMPORT_MAX_CHARS = SKILL_BODY_MAX + SKILL_DESCRIPTION_MAX + 1_000;

export type SkillDetail = SableSkillInput & { source: "builtin" | "custom" };
export type SkillTarget = { name: string; id?: string };

async function requireAdmin() {
  const me = await getCurrentUser();
  if (!me || !me.isActive || !hasRole(me.role as Role, "ADMIN")) return null;
  return me;
}

const NOT_AUTHORISED = { ok: false, error: "Not authorised" } satisfies ActionResult;

function normalize(input: SableSkillInput): SableSkillInput {
  return { name: input.name.trim(), description: input.description.trim(), body: input.body.trim() };
}

async function builtinNames(): Promise<Set<string>> {
  return new Set((await readBuiltinSkills()).map((s) => s.name));
}

/** Why `skill` cannot be stored as a custom skill (invalid, or its name is taken), or null. */
async function rejectCustomSkill(skill: SableSkillInput, ownId?: string): Promise<string | null> {
  const invalid = validateSkill(skill);
  if (invalid) return invalid;
  if ((await builtinNames()).has(skill.name)) {
    return `"${skill.name}" is a built-in skill. Choose another name.`;
  }
  const taken = await db.aiSkill.findUnique({ where: { name: skill.name }, select: { id: true } });
  if (taken && taken.id !== ownId) return `A skill named "${skill.name}" already exists.`;
  return null;
}

/** Every change takes effect on the next agent run: drop the synced workspace and refresh the page. */
function applied(): ActionResult {
  invalidateSableWorkspace();
  revalidatePath(SETTINGS_PATH);
  return { ok: true };
}

async function createFrom(userId: string, input: SableSkillInput): Promise<ActionResult> {
  const skill = normalize(input);
  const rejected = await rejectCustomSkill(skill);
  if (rejected) return { ok: false, error: rejected };

  const created = await db.aiSkill.create({ data: skill });
  await writeAudit({
    userId,
    action: "CREATE",
    entity: "AiSkill",
    entityId: created.id,
    summary: `Created ${AI_ASSISTANT_NAME} skill "${skill.name}"`,
  });
  return applied();
}

export async function createSkill(input: SableSkillInput): Promise<ActionResult> {
  const me = await requireAdmin();
  if (!me) return NOT_AUTHORISED;
  return createFrom(me.id, input);
}

/** Creates a custom skill from the text of an uploaded SKILL.md. */
export async function importSkill(markdown: string): Promise<ActionResult> {
  const me = await requireAdmin();
  if (!me) return NOT_AUTHORISED;
  if (markdown.length > IMPORT_MAX_CHARS) return { ok: false, error: "The file is too large for a skill." };

  let parsed: SableSkillInput;
  try {
    parsed = parseSkillMarkdown(markdown);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Could not read the file." };
  }
  return createFrom(me.id, parsed);
}

export async function updateSkill(id: string, input: SableSkillInput): Promise<ActionResult> {
  const me = await requireAdmin();
  if (!me) return NOT_AUTHORISED;

  const existing = await db.aiSkill.findUnique({ where: { id }, select: { name: true } });
  if (!existing) return { ok: false, error: "Skill not found." };

  const skill = normalize(input);
  const rejected = await rejectCustomSkill(skill, id);
  if (rejected) return { ok: false, error: rejected };

  await db.aiSkill.update({ where: { id }, data: skill });
  await writeAudit({
    userId: me.id,
    action: "UPDATE",
    entity: "AiSkill",
    entityId: id,
    summary: `Updated ${AI_ASSISTANT_NAME} skill "${skill.name}"`,
  });
  return applied();
}

/** Takes the skill's `id` from a form field, so it can sit behind a ConfirmButton. */
export async function deleteSkill(formData: FormData): Promise<ActionResult> {
  const me = await requireAdmin();
  if (!me) return NOT_AUTHORISED;

  const id = String(formData.get("id") ?? "");
  const removed = await db.aiSkill.deleteMany({ where: { id } });
  if (removed.count === 0) return { ok: false, error: "Skill not found." };

  await writeAudit({
    userId: me.id,
    action: "DELETE",
    entity: "AiSkill",
    entityId: id,
    summary: `Deleted ${AI_ASSISTANT_NAME} skill`,
  });
  return applied();
}

/** Custom skills are toggled by `id`; a target without one is a built-in, toggled by `name`. */
export async function setSkillEnabled(target: SkillTarget, enabled: boolean): Promise<ActionResult> {
  const me = await requireAdmin();
  if (!me) return NOT_AUTHORISED;

  if (target.id) {
    const updated = await db.aiSkill.updateMany({ where: { id: target.id }, data: { enabled } });
    if (updated.count === 0) return { ok: false, error: "Skill not found." };
  } else {
    if (!(await builtinNames()).has(target.name)) return { ok: false, error: "Skill not found." };
    const disabled = await getDisabledBuiltinSkills();
    if (enabled) disabled.delete(target.name);
    else disabled.add(target.name);
    await setSetting(DISABLED_SKILLS_SETTING, [...disabled].sort().join(","), { userId: me.id });
  }

  await writeAudit({
    userId: me.id,
    action: "UPDATE",
    entity: "AiSkill",
    entityId: target.id ?? target.name,
    summary: `${enabled ? "Enabled" : "Disabled"} ${AI_ASSISTANT_NAME} skill "${target.name}"`,
  });
  return applied();
}

/** One skill's full text, fetched when the admin opens it (the list stays small). */
export async function getSkill(target: SkillTarget): Promise<SkillDetail | null> {
  if (!(await requireAdmin())) return null;

  if (target.id) {
    const row = await db.aiSkill.findUnique({ where: { id: target.id } });
    if (!row) return null;
    return { name: row.name, description: row.description, body: row.body, source: "custom" };
  }
  const builtin = (await readBuiltinSkills()).find((s) => s.name === target.name);
  if (!builtin) return null;
  return { name: builtin.name, description: builtin.description, body: builtin.body, source: "builtin" };
}
