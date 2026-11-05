import { copyFile, mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { db } from "@/lib/db";
import { getSetting } from "@/lib/settings";
import { parseSkillMarkdown, renderSkillMarkdown, validateSkill, type SableSkillInput } from "@/lib/sable-skills";

/**
 * Sable's isolated home for the Claude Code harness. The CLI never runs in the
 * Servio repo or with the operator's own Claude config. It gets its own
 * CLAUDE_CONFIG_DIR holding ONLY Sable's charter (CLAUDE.md) and its enabled
 * skills, and loads nothing but that "user" tier: no project tier, because
 * Claude Code's project lookup walks up the parent directories (and their
 * `.claude/CLAUDE.md`) — under a home directory that would pull in the
 * operator's own instructions. The working directory is an empty folder. Both
 * live under SABLE_HOME (default ~/.servio/sable).
 *
 * Skills come from two sources: the built-in ITSM skills versioned in
 * `sable/skills` and admin-managed custom skills (`AiSkill` rows). Admins can
 * disable any of them; disabled built-ins are named in the AppSetting
 * SABLE_DISABLED_SKILLS (comma-separated).
 */
export type SableWorkspace = {
  /** Empty working directory of the agent. */
  cwd: string;
  /** Dedicated Claude Code config dir (CLAUDE_CONFIG_DIR): charter + skills. */
  configDir: string;
  /** Names of the enabled skills the agent can load. */
  skills: string[];
};

/** Who a run serves: console agents (charter + skills) or portal end users (neither). */
export type SableAudience = "console" | "portal";

export type SableSkill = {
  name: string;
  description: string;
  source: "builtin" | "custom";
  enabled: boolean;
  /** Database id; custom skills only. */
  id?: string;
};

/** A built-in skill: its parsed parts plus the SKILL.md text exactly as shipped. */
export type BuiltinSkill = SableSkillInput & { markdown: string };

export const DISABLED_SKILLS_SETTING = "SABLE_DISABLED_SKILLS";

const TEMPLATE_DIR = path.join(process.cwd(), "sable");
const CHARTER_FILE = "AGENT.md";
const SKILLS_DIR = "skills";
const SKILL_FILE = "SKILL.md";

function sableHome(): string {
  return process.env.SABLE_HOME || path.join(homedir(), ".servio", "sable");
}

/** The skills shipped in `sable/skills`, sorted by name. */
export async function readBuiltinSkills(): Promise<BuiltinSkill[]> {
  const dir = path.join(TEMPLATE_DIR, SKILLS_DIR);
  const entries = await readdir(dir, { withFileTypes: true });
  const skills = await Promise.all(
    entries
      .filter((e) => e.isDirectory())
      .map(async (e) => {
        const markdown = await readFile(path.join(dir, e.name, SKILL_FILE), "utf8");
        return { ...parseSkillMarkdown(markdown), name: e.name, markdown };
      }),
  );
  return skills.sort((a, b) => a.name.localeCompare(b.name));
}

export async function getDisabledBuiltinSkills(): Promise<Set<string>> {
  const raw = (await getSetting(DISABLED_SKILLS_SETTING)) ?? "";
  return new Set(raw.split(",").map((name) => name.trim()).filter(Boolean));
}

/**
 * Enabled custom skills. A custom skill never shadows a built-in name, and a
 * row that fails validation (hand-edited DB) is skipped: its name becomes a
 * directory, so it must be a plain kebab-case name.
 */
function usableCustomSkills<T extends SableSkillInput>(rows: T[], builtinNames: Set<string>): T[] {
  return rows.filter((row) => !builtinNames.has(row.name) && validateSkill(row) === null);
}

async function syncWorkspace(): Promise<SableWorkspace> {
  const home = sableHome();
  const cwd = path.join(home, "workspace");
  const configDir = path.join(home, "config");
  const skillsTarget = path.join(configDir, SKILLS_DIR);

  const [builtins, disabled, customRows] = await Promise.all([
    readBuiltinSkills(),
    getDisabledBuiltinSkills(),
    db.aiSkill.findMany({ where: { enabled: true } }),
  ]);
  const builtinNames = new Set(builtins.map((s) => s.name));
  const wanted = new Map<string, string>([
    ...builtins.filter((s) => !disabled.has(s.name)).map((s) => [s.name, s.markdown] as const),
    ...usableCustomSkills(customRows, builtinNames).map((s) => [s.name, renderSkillMarkdown(s)] as const),
  ]);

  await mkdir(cwd, { recursive: true });
  await mkdir(skillsTarget, { recursive: true });
  await copyFile(path.join(TEMPLATE_DIR, CHARTER_FILE), path.join(configDir, "CLAUDE.md"));

  // Overwrite the wanted skills in place and prune the rest, so a run that is
  // still going never finds the whole skills directory emptied — nor a
  // half-written SKILL.md (each is written to a temp file, then renamed).
  for (const [name, markdown] of wanted) {
    await mkdir(path.join(skillsTarget, name), { recursive: true });
    const target = path.join(skillsTarget, name, SKILL_FILE);
    const temp = `${target}.${process.pid}.tmp`;
    await writeFile(temp, markdown, "utf8");
    await rename(temp, target);
  }
  const existing = await readdir(skillsTarget, { withFileTypes: true });
  await Promise.all(
    existing
      .filter((e) => !wanted.has(e.name))
      .map((e) => rm(path.join(skillsTarget, e.name), { recursive: true, force: true })),
  );

  return { cwd, configDir, skills: [...wanted.keys()] };
}

/** Every skill for the settings page: built-ins first, then custom ones, each sorted by name. */
export async function listSableSkills(): Promise<SableSkill[]> {
  const [builtins, disabled, customRows] = await Promise.all([
    readBuiltinSkills(),
    getDisabledBuiltinSkills(),
    db.aiSkill.findMany({ orderBy: { name: "asc" } }),
  ]);
  const builtinNames = new Set(builtins.map((s) => s.name));
  return [
    ...builtins.map((s) => ({
      name: s.name,
      description: s.description,
      source: "builtin" as const,
      enabled: !disabled.has(s.name),
    })),
    ...customRows
      .filter((row) => !builtinNames.has(row.name))
      .map((row) => ({
        name: row.name,
        description: row.description,
        source: "custom" as const,
        enabled: row.enabled,
        id: row.id,
      })),
  ];
}

/**
 * Process-wide (survives dev HMR). `current` is the sync every run awaits;
 * `tail` is the last started sync, so a re-sync after an invalidation queues
 * behind a still-running one instead of racing its file writes.
 */
const STATE_KEY = Symbol.for("servio.sableWorkspace");
type SyncState = { current?: Promise<SableWorkspace>; tail: Promise<unknown> };
type GlobalWithWorkspace = typeof globalThis & { [STATE_KEY]?: SyncState };

function syncState(): SyncState {
  const holder = globalThis as GlobalWithWorkspace;
  return (holder[STATE_KEY] ??= { tail: Promise.resolve() });
}

/**
 * Prepare Sable's isolated workspace and return its paths. The result is
 * reused until `invalidateSableWorkspace()`. A failed sync is not cached, so
 * the next run retries.
 */
export function ensureSableWorkspace(): Promise<SableWorkspace> {
  const state = syncState();
  if (state.current) return state.current;

  const sync: Promise<SableWorkspace> = state.tail.then(syncWorkspace).catch((error: unknown) => {
    if (state.current === sync) state.current = undefined;
    throw new Error(
      `Could not prepare Sable's workspace in ${sableHome()}: ${error instanceof Error ? error.message : String(error)}`,
    );
  });
  state.current = sync;
  state.tail = sync.catch(() => undefined);
  return sync;
}

/**
 * The self-service portal's workspace: the same isolation, but its own EMPTY
 * config dir — end users get neither the console charter nor any skill.
 */
export async function ensurePortalWorkspace(): Promise<SableWorkspace> {
  const home = sableHome();
  const workspace = { cwd: path.join(home, "workspace-portal"), configDir: path.join(home, "config-portal"), skills: [] };
  await mkdir(workspace.cwd, { recursive: true });
  await mkdir(workspace.configDir, { recursive: true });
  return workspace;
}

/** Call after any change to skills or their enabled state: the next agent run re-syncs the workspace. */
export function invalidateSableWorkspace(): void {
  syncState().current = undefined;
}
