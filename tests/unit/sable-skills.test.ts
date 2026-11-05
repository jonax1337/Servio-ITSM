import { describe, expect, it } from "vitest";
import {
  parseSkillMarkdown,
  renderSkillMarkdown,
  SKILL_BODY_MAX,
  SKILL_DESCRIPTION_MAX,
  SKILL_NAME_MAX,
  validateSkill,
  type SableSkillInput,
} from "@/lib/sable-skills";

const VALID: SableSkillInput = { name: "vpn-troubleshooting", description: "Use when a VPN fails.", body: "# VPN\n\nCheck the client." };

describe("validateSkill", () => {
  it("accepts a valid skill", () => {
    expect(validateSkill(VALID)).toBeNull();
  });

  it.each(["", "Upper", "snake_case", "-lead", "trail-", "double--hyphen", "has space", "ümlaut"])(
    "rejects the name %j",
    (name) => {
      expect(validateSkill({ ...VALID, name })).toMatch(/Name/);
    },
  );

  it("accepts a name of exactly 64 characters and rejects 65", () => {
    expect(validateSkill({ ...VALID, name: "a".repeat(SKILL_NAME_MAX) })).toBeNull();
    expect(validateSkill({ ...VALID, name: "a".repeat(SKILL_NAME_MAX + 1) })).toMatch(/at most 64/);
  });

  it("accepts digits and single hyphens", () => {
    expect(validateSkill({ ...VALID, name: "l2-support-3" })).toBeNull();
  });

  it("accepts a description of 1 and 1024 characters, rejects empty and 1025", () => {
    expect(validateSkill({ ...VALID, description: "x" })).toBeNull();
    expect(validateSkill({ ...VALID, description: "x".repeat(SKILL_DESCRIPTION_MAX) })).toBeNull();
    expect(validateSkill({ ...VALID, description: "  " })).toMatch(/Description is required/);
    expect(validateSkill({ ...VALID, description: "x".repeat(SKILL_DESCRIPTION_MAX + 1) })).toMatch(/at most 1024/);
  });

  it("rejects a multi-line description", () => {
    expect(validateSkill({ ...VALID, description: "one\ntwo" })).toMatch(/single line/);
    expect(validateSkill({ ...VALID, description: "one\rtwo" })).toMatch(/single line/);
  });

  it("accepts a body of 50000 characters, rejects empty and 50001", () => {
    expect(validateSkill({ ...VALID, body: "b".repeat(SKILL_BODY_MAX) })).toBeNull();
    expect(validateSkill({ ...VALID, body: " \n " })).toMatch(/body is required/);
    expect(validateSkill({ ...VALID, body: "b".repeat(SKILL_BODY_MAX + 1) })).toMatch(/at most 50000/);
  });
});

describe("parseSkillMarkdown", () => {
  it("reads an unquoted SKILL.md", () => {
    const text = "---\nname: change-management\ndescription: Use when planning a change.\n---\n\n# Change\n\nText.\n";
    expect(parseSkillMarkdown(text)).toEqual({
      name: "change-management",
      description: "Use when planning a change.",
      body: "# Change\n\nText.",
    });
  });

  it("tolerates CRLF line endings and a BOM", () => {
    const text = "﻿---\r\nname: crlf-skill\r\ndescription: Windows file\r\n---\r\n\r\nLine one\r\nLine two\r\n";
    expect(parseSkillMarkdown(text)).toEqual({
      name: "crlf-skill",
      description: "Windows file",
      body: "Line one\nLine two",
    });
  });

  it("unquotes double- and single-quoted values", () => {
    const text = "---\nname: 'quoted-skill'\ndescription: \"Say \\\"hi\\\" \\\\ there: ok\"\n---\nBody";
    expect(parseSkillMarkdown(text)).toEqual({
      name: "quoted-skill",
      description: 'Say "hi" \\ there: ok',
      body: "Body",
    });
    expect(parseSkillMarkdown("---\nname: a\ndescription: 'it''s fine'\n---\nB").description).toBe("it's fine");
  });

  it("keeps colons and quotes inside an unquoted description", () => {
    const text = '---\nname: a\ndescription: Use when asked "what now?": answer\n---\nB';
    expect(parseSkillMarkdown(text).description).toBe('Use when asked "what now?": answer');
  });

  it("ignores unknown frontmatter fields and keeps horizontal rules in the body", () => {
    const text = "---\nname: a\nallowed-tools: Read\ndescription: D\n---\nTop\n\n---\n\nBottom";
    expect(parseSkillMarkdown(text)).toEqual({ name: "a", description: "D", body: "Top\n\n---\n\nBottom" });
  });

  it("allows an empty body", () => {
    expect(parseSkillMarkdown("---\nname: a\ndescription: D\n---").body).toBe("");
  });

  it("throws a readable error for missing frontmatter, name or description", () => {
    expect(() => parseSkillMarkdown("# Just markdown")).toThrow(/no frontmatter/);
    expect(() => parseSkillMarkdown("---\ndescription: D\n---\nB")).toThrow(/no name/);
    expect(() => parseSkillMarkdown("---\nname: a\n---\nB")).toThrow(/no description/);
  });
});

describe("renderSkillMarkdown", () => {
  it("renders frontmatter and body", () => {
    expect(renderSkillMarkdown(VALID)).toBe(
      '---\nname: vpn-troubleshooting\ndescription: "Use when a VPN fails."\n---\n\n# VPN\n\nCheck the client.\n',
    );
  });

  it.each([
    'Contains "double quotes"',
    "Contains 'single' quotes",
    "Backslash \\ and \\\" mix",
    "Colon: and # hash and - dash",
    "[bracket] {brace} > folded | pipe",
    "  surrounded by spaces",
    "Umlaute äöü and emoji-free text",
  ])("round-trips the description %j", (description) => {
    const skill = { ...VALID, description };
    expect(parseSkillMarkdown(renderSkillMarkdown(skill))).toEqual(skill);
  });

  it("round-trips a multi-line body", () => {
    const skill = { ...VALID, body: "# Title\n\n---\n\n- a\n- b" };
    expect(parseSkillMarkdown(renderSkillMarkdown(skill))).toEqual(skill);
  });
});
