"use server";

import { z } from "zod";
import type { ActionResult } from "@/lib/action-result";
import { requireAgentUser } from "@/lib/session";
import { RELEASE_STATUSES } from "@/lib/constants";
import {
  addChangeToRelease,
  createRelease,
  moveRelease,
  removeChangeFromRelease,
  updateRelease,
  type CreateReleaseResult,
  type ReleaseInput,
} from "@/lib/releases";

const NOT_AUTHORISED = { ok: false, error: "Not authorised." } as const;
const INVALID_REQUEST = { ok: false, error: "Invalid request." } as const;

const optionalId = z
  .string()
  .optional()
  .transform((v) => (v && v !== "none" ? v : null));

const optionalText = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() ? v.trim() : null));

const releaseSchema = z.object({
  name: z.string().default(""),
  description: optionalText,
  ownerId: optionalId,
  groupId: optionalId,
});

const releaseIdSchema = z.object({ id: z.coerce.number().int().positive() });
const statusSchema = releaseIdSchema.extend({ status: z.enum(RELEASE_STATUSES) });
const bundleSchema = z.object({
  releaseId: z.coerce.number().int().positive(),
  changeId: z.coerce.number().int().positive(),
});

function releaseInput(formData: FormData): ReleaseInput | null {
  const parsed = releaseSchema.safeParse(Object.fromEntries(formData));
  return parsed.success ? parsed.data : null;
}

export async function createReleaseAction(formData: FormData): Promise<CreateReleaseResult> {
  const me = await requireAgentUser();
  if (!me) return NOT_AUTHORISED;
  const input = releaseInput(formData);
  return input ? createRelease(me.id, input) : INVALID_REQUEST;
}

export async function updateReleaseAction(formData: FormData): Promise<ActionResult> {
  const me = await requireAgentUser();
  if (!me) return NOT_AUTHORISED;
  const id = releaseIdSchema.safeParse(Object.fromEntries(formData));
  const input = releaseInput(formData);
  return id.success && input ? updateRelease(me.id, id.data.id, input) : INVALID_REQUEST;
}

export async function setReleaseStatusAction(formData: FormData): Promise<ActionResult> {
  const me = await requireAgentUser();
  if (!me) return NOT_AUTHORISED;
  const parsed = statusSchema.safeParse(Object.fromEntries(formData));
  return parsed.success ? moveRelease(me.id, parsed.data.id, parsed.data.status) : INVALID_REQUEST;
}

export async function addChangeToReleaseAction(formData: FormData): Promise<ActionResult> {
  const me = await requireAgentUser();
  if (!me) return NOT_AUTHORISED;
  const parsed = bundleSchema.safeParse(Object.fromEntries(formData));
  return parsed.success ? addChangeToRelease(me.id, parsed.data.releaseId, parsed.data.changeId) : INVALID_REQUEST;
}

export async function removeChangeFromReleaseAction(formData: FormData): Promise<ActionResult> {
  const me = await requireAgentUser();
  if (!me) return NOT_AUTHORISED;
  const parsed = bundleSchema.safeParse(Object.fromEntries(formData));
  return parsed.success ? removeChangeFromRelease(me.id, parsed.data.releaseId, parsed.data.changeId) : INVALID_REQUEST;
}
