/**
 * Pure helpers for Sable's skills (SKILL.md files): validation, parsing and
 * rendering. No DB or filesystem access, so they are usable from server
 * actions, the workspace sync and tests alike.
 */
export type SableSkillInput = { name: string; description: string; body: string };

export const SKILL_NAME_MAX = 64;
export const SKILL_DESCRIPTION_MAX = 1024;
export const SKILL_BODY_MAX = 50_000;

const SKILL_NAME_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/;
const FRONTMATTER = /^---[ \t]*\n([\s\S]*?)\n---[ \t]*(?:\n([\s\S]*))?$/;
const FRONTMATTER_FIELD = /^([A-Za-z][\w-]*):[ \t]*(.*)$/;

/** The first problem found, as a message for the admin, or null when the skill is valid. */
export function validateSkill({ name, description, body }: SableSkillInput): string | null {
  if (!name) return "Name is required.";
  if (name.length > SKILL_NAME_MAX) return `Name must be at most ${SKILL_NAME_MAX} characters.`;
  if (!SKILL_NAME_PATTERN.test(name)) {
    return "Name must be kebab-case: lowercase letters and digits separated by single hyphens.";
  }
  if (!description.trim()) return "Description is required.";
  if (description.length > SKILL_DESCRIPTION_MAX) {
    return `Description must be at most ${SKILL_DESCRIPTION_MAX} characters.`;
  }
  if (CONTROL_CHARACTER.test(description)) return "Description must be a single line.";
  if (!body.trim()) return "The skill body is required.";
  if (body.length > SKILL_BODY_MAX) return `The skill body must be at most ${SKILL_BODY_MAX} characters.`;
  return null;
}

function unquote(raw: string): string {
  const value = raw.trim();
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1).replace(/\\(["\\])/g, "$1");
  }
  if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1).replace(/''/g, "'");
  }
  return value;
}

/** Reads name, description and body from a SKILL.md. Throws with a readable message when malformed. */
export function parseSkillMarkdown(text: string): SableSkillInput {
  const normalized = text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  const match = normalized.match(FRONTMATTER);
  if (!match) throw new Error("The file has no frontmatter. A SKILL.md starts with --- name / description ---.");

  const fields = new Map<string, string>();
  for (const line of match[1].split("\n")) {
    const field = line.match(FRONTMATTER_FIELD);
    if (field) fields.set(field[1], unquote(field[2]));
  }

  const name = fields.get("name");
  const description = fields.get("description");
  if (!name) throw new Error("The frontmatter has no name.");
  if (!description) throw new Error("The frontmatter has no description.");
  return { name, description, body: (match[2] ?? "").trim() };
}

/** SKILL.md text: frontmatter plus body. The description is always double-quoted so any text stays valid YAML. */
export function renderSkillMarkdown({ name, description, body }: SableSkillInput): string {
  const quoted = `"${description.replace(/[\\"]/g, "\\$&")}"`;
  return `---\nname: ${name}\ndescription: ${quoted}\n---\n\n${body.trim()}\n`;
}
