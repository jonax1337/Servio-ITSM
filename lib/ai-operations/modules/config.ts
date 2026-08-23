import { z } from "zod";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { setSetting } from "@/lib/settings";
import { PRIORITIES } from "@/lib/constants";
import {
  createSla,
  updateSla,
  toggleSla,
  deleteSla,
} from "@/lib/actions/sla-admin";
import {
  toggleRule,
  deleteRule,
} from "@/lib/actions/automations";
import type { AiOperation } from "../types";
import { ok, err, str, toFormData, coerceEnum } from "../helpers";

/**
 * System configuration: SLAs, app settings, and automation rules. We reuse the
 * app's real (non-redirecting) form actions where they exist so RBAC and
 * validation stay in one place; the toggle actions flip state, so we read the
 * current value first and only call them when a change is actually needed.
 */

// Non-secret keys an ADMIN may change through Sable. Anything else — anything that
// looks like a credential, or any privacy/provider key in SELF_LOCKED_SETTING_KEYS
// below — is rejected outright.
const ALLOWED_SETTING_KEYS = [
  "APP_NAME",
  "APP_URL",
  "AI_MODEL",
  "AI_MAX_OUTPUT_TOKENS",
  "AI_TEASER",
  "OLLAMA_BASE_URL",
  "OLLAMA_MODEL",
  "MAX_UPLOAD_MB",
  "SMTP_HOST",
  "SMTP_PORT",
  "SMTP_SECURE",
  "SMTP_USER",
  "SMTP_FROM",
] as const;

const SECRET_MARKERS = ["KEY", "PASS", "SECRET", "TOKEN"];

// Privacy-critical keys Sable must never change about itself: flipping these could
// steer an admin (via prompt-injection) into opening the off-box data path or
// swapping the model provider — OLLAMA_BASE_URL included, because with the ollama
// provider every chat payload (ticket transcripts, attached file text) is POSTed
// to that URL. They stay editable in the real Settings UI, just not through the
// AI operation layer. This deny-list takes precedence over the allow-list.
const SELF_LOCKED_SETTING_KEYS = ["AI_ALLOW_EXTERNAL", "AI_PROVIDER", "OLLAMA_BASE_URL"];

export const OPERATIONS: AiOperation[] = [
  {
    id: "sla.create",
    group: "SLAs",
    kind: "write",
    minRole: "MANAGER",
    description:
      "Create an SLA policy with response and resolution targets (in minutes). Optionally scope it to a priority.",
    input: z.object({
      name: z.string().min(2).describe("SLA name"),
      description: z.string().optional(),
      priority: z.enum(PRIORITIES).optional().describe("priority this SLA applies to"),
      responseMins: z.number().min(1).describe("response target in minutes"),
      resolveMins: z.number().min(1).describe("resolution target in minutes"),
      isActive: z.boolean().optional().describe("whether the SLA is active (default true)"),
    }),
    label: (a) => `Create SLA “${a.name}”`,
    run: async (a) => {
      const name = str(a.name);
      if (!name || name.length < 2) return err("SLA name is too short.");
      const priority = a.priority !== undefined ? coerceEnum(a.priority, PRIORITIES) : undefined;
      if (a.priority !== undefined && priority === null) return err(`Invalid priority: ${String(a.priority)}`);
      const isActive = a.isActive as boolean | undefined;
      const result = await createSla(
        undefined,
        toFormData({
          name,
          description: str(a.description),
          priority: priority ?? undefined,
          responseMins: Number(a.responseMins),
          resolveMins: Number(a.resolveMins),
          isActive: isActive === false ? "" : "on",
        }),
      );
      if (result?.error) return err(result.error);
      return ok(`Created SLA "${name}"`);
    },
  },
  {
    id: "sla.update",
    group: "SLAs",
    kind: "write",
    minRole: "MANAGER",
    description:
      "Update an existing SLA policy (identify it by its current name). Only the fields you provide are changed.",
    input: z.object({
      current: z.string().describe("the SLA's current name"),
      name: z.string().optional().describe("new name"),
      description: z.string().optional(),
      priority: z.enum(PRIORITIES).optional(),
      responseMins: z.number().min(1).optional().describe("response target in minutes"),
      resolveMins: z.number().min(1).optional().describe("resolution target in minutes"),
      isActive: z.boolean().optional(),
    }),
    label: (a) => `Update SLA “${a.current}”`,
    run: async (a) => {
      const currentName = str(a.current);
      if (!currentName) return err("SLA name is required.");
      const sla = await db.sLA.findFirst({
        where: { name: currentName },
        select: {
          id: true,
          name: true,
          description: true,
          priority: true,
          responseMins: true,
          resolveMins: true,
          isActive: true,
        },
      });
      if (!sla) return err(`SLA not found: ${currentName}`);

      const priority = a.priority !== undefined ? coerceEnum(a.priority, PRIORITIES) : undefined;
      if (a.priority !== undefined && priority === null) return err(`Invalid priority: ${String(a.priority)}`);

      // updateSla re-validates the whole record, so send the current values for
      // anything the caller didn't override.
      const name = str(a.name) ?? sla.name;
      const description = a.description !== undefined ? str(a.description) : (sla.description ?? undefined);
      const finalPriority = priority ?? (sla.priority ?? undefined);
      const responseMins = a.responseMins !== undefined ? Number(a.responseMins) : sla.responseMins;
      const resolveMins = a.resolveMins !== undefined ? Number(a.resolveMins) : sla.resolveMins;
      const isActive = a.isActive !== undefined ? (a.isActive as boolean) : sla.isActive;

      const result = await updateSla(
        undefined,
        toFormData({
          id: sla.id,
          name,
          description,
          priority: finalPriority,
          responseMins,
          resolveMins,
          isActive: isActive === false ? "" : "on",
        }),
      );
      if (result?.error) return err(result.error);
      return ok(`Updated SLA "${name}"`);
    },
  },
  {
    id: "sla.set_active",
    group: "SLAs",
    kind: "write",
    minRole: "MANAGER",
    description: "Activate or deactivate an SLA policy (identify it by name).",
    input: z.object({
      name: z.string().describe("SLA name"),
      active: z.boolean().describe("true to activate, false to deactivate"),
    }),
    label: (a) => `${a.active ? "Activate" : "Deactivate"} SLA “${a.name}”`,
    run: async (a) => {
      const name = str(a.name);
      if (!name) return err("SLA name is required.");
      const active = a.active as boolean;
      const sla = await db.sLA.findFirst({ where: { name }, select: { id: true, isActive: true } });
      if (!sla) return err(`SLA not found: ${name}`);
      if (sla.isActive === active) {
        return ok(`SLA "${name}" is already ${active ? "active" : "inactive"}.`);
      }
      await toggleSla(toFormData({ id: sla.id }));
      return ok(`${active ? "Activated" : "Deactivated"} SLA "${name}"`);
    },
  },
  {
    id: "sla.delete",
    group: "SLAs",
    kind: "write",
    minRole: "MANAGER",
    description: "Delete an SLA policy by name (existing tickets keep their stamped deadlines).",
    input: z.object({ name: z.string().describe("SLA name to delete") }),
    label: (a) => `Delete SLA “${a.name}”`,
    run: async (a) => {
      const name = str(a.name);
      if (!name) return err("SLA name is required.");
      const sla = await db.sLA.findFirst({ where: { name }, select: { id: true, name: true } });
      if (!sla) return err(`SLA not found: ${name}`);
      await deleteSla(toFormData({ id: sla.id }));
      return ok(`Deleted SLA "${sla.name}"`);
    },
  },
  {
    id: "setting.update",
    group: "Settings",
    kind: "write",
    minRole: "ADMIN",
    adminOnly: true,
    description:
      "Change a non-secret app setting (e.g. APP_NAME, AI_MODEL, SMTP_HOST). Secret keys (API keys, passwords, tokens) cannot be changed here.",
    input: z.object({
      key: z.string().describe("setting key, e.g. APP_NAME"),
      value: z.string().describe("new value"),
    }),
    label: (a) => `Set ${a.key}`,
    run: async (a, ctx) => {
      const key = str(a.key)?.toUpperCase();
      if (!key) return err("Setting key is required.");
      if (SELF_LOCKED_SETTING_KEYS.includes(key)) {
        return err("That setting controls Sable's own privacy/provider and cannot be changed here — use the Settings UI.");
      }
      const looksSecret = SECRET_MARKERS.some((m) => key.includes(m));
      const allowed = (ALLOWED_SETTING_KEYS as readonly string[]).includes(key);
      if (looksSecret || !allowed) {
        return err("That setting cannot be changed here (or is a secret).");
      }
      const value = String(a.value ?? "");
      await setSetting(key, value, { userId: ctx.userId });
      await writeAudit({
        userId: ctx.userId,
        action: "UPDATE",
        entity: "AppSetting",
        entityId: key,
        summary: `Set ${key} via Sable`,
      });
      return ok(`Set ${key}`);
    },
  },
  {
    id: "automation.set_active",
    group: "Automations",
    kind: "write",
    minRole: "MANAGER",
    description: "Activate or deactivate an automation rule (identify it by name).",
    input: z.object({
      name: z.string().describe("automation rule name"),
      active: z.boolean().describe("true to activate, false to deactivate"),
    }),
    label: (a) => `${a.active ? "Activate" : "Deactivate"} automation “${a.name}”`,
    run: async (a) => {
      const name = str(a.name);
      if (!name) return err("Automation rule name is required.");
      const active = a.active as boolean;
      const rule = await db.automationRule.findFirst({ where: { name }, select: { id: true, isActive: true } });
      if (!rule) return err(`Automation rule not found: ${name}`);
      if (rule.isActive === active) {
        return ok(`Automation "${name}" is already ${active ? "active" : "inactive"}.`);
      }
      await toggleRule(toFormData({ id: rule.id }));
      return ok(`${active ? "Activated" : "Deactivated"} automation "${name}"`);
    },
  },
  {
    id: "automation.delete",
    group: "Automations",
    kind: "write",
    minRole: "MANAGER",
    description: "Delete an automation rule by name.",
    input: z.object({ name: z.string().describe("automation rule name to delete") }),
    label: (a) => `Delete automation “${a.name}”`,
    run: async (a) => {
      const name = str(a.name);
      if (!name) return err("Automation rule name is required.");
      const rule = await db.automationRule.findFirst({ where: { name }, select: { id: true, name: true } });
      if (!rule) return err(`Automation rule not found: ${name}`);
      await deleteRule(toFormData({ id: rule.id }));
      return ok(`Deleted automation "${rule.name}"`);
    },
  },
];
