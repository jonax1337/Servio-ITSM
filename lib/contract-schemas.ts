/**
 * Zod schemas for the vendor, contract and license forms. The forms post
 * strings (FormData), so every field parses text into its stored type and
 * reports a message that names the field.
 */
import { z } from "zod";
import { CONTRACT_TYPES, CONTRACT_STATUSES, LICENSE_TYPES } from "@/lib/constants";
import { DEFAULT_RENEWAL_NOTICE_DAYS } from "@/lib/contract-rules";

const optionalText = z
  .string()
  .optional()
  .transform((v) => v?.trim() || null);

export const optionalId = z
  .string()
  .optional()
  .transform((v) => (v && v !== "none" ? v : null));

const checkbox = z
  .string()
  .optional()
  .transform((v) => v === "on" || v === "true");

const requiredDate = (label: string) =>
  z
    .string({ error: `${label} is required` })
    .min(1, `${label} is required`)
    .pipe(z.coerce.date({ error: `${label} is not a valid date` }));

const optionalDate = (label: string) =>
  optionalText
    .transform((v) => (v === null ? null : new Date(v)))
    .pipe(z.date({ error: `${label} is not a valid date` }).nullable());

const optionalCost = optionalText
  .transform((v) => (v === null ? null : Number(v)))
  .pipe(z.number({ error: "Cost must be a number" }).min(0, "Cost can't be negative").nullable());

const wholeNumber = (label: string, min: number, max: number, fallback: number) =>
  z
    .string()
    .optional()
    .transform((v) => (v?.trim() ? Number(v) : fallback))
    .pipe(
      z
        .number({ error: `${label} must be a number` })
        .int(`${label} must be a whole number`)
        .min(min, `${label} must be at least ${min}`)
        .max(max, `${label} must be at most ${max}`),
    );

export const vendorSchema = z.object({
  name: z.string().trim().min(2, "Name must be at least 2 characters"),
  website: optionalText,
  email: optionalText.pipe(z.email("Enter a valid email address").nullable()),
  phone: optionalText,
  notes: optionalText,
  isActive: checkbox,
});

export const contractSchema = z.object({
  name: z.string().trim().min(2, "Name must be at least 2 characters"),
  number: optionalText,
  type: z.enum(CONTRACT_TYPES, { error: "Choose a contract type" }),
  status: z.enum(CONTRACT_STATUSES, { error: "Choose a contract status" }),
  vendorId: optionalId,
  ownerId: optionalId,
  startDate: requiredDate("Start date"),
  endDate: optionalDate("End date"),
  cost: optionalCost,
  renewalNoticeDays: wholeNumber("Renewal notice", 0, 3650, DEFAULT_RENEWAL_NOTICE_DAYS),
  autoRenew: checkbox,
  notes: optionalText,
});

export const licenseSchema = z.object({
  name: z.string().trim().min(2, "Name must be at least 2 characters"),
  vendorId: optionalId,
  contractId: optionalId,
  ownerId: optionalId,
  licenseType: z.enum(LICENSE_TYPES, { error: "Choose a license type" }),
  seats: wholeNumber("Seats", 1, 1_000_000, 1),
  expiresAt: optionalDate("Expiry date"),
  cost: optionalCost,
  notes: optionalText,
});
