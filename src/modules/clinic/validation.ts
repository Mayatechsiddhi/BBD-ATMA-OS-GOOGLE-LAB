import { z } from "zod";
export const leadStatus = z.enum([
  "NEW",
  "CONTACTED",
  "QUALIFIED",
  "CONVERTED",
  "LOST",
]);
export const sources = [
  "PHONE",
  "WALK_IN",
  "WEBSITE",
  "REFERRAL",
  "OTHER",
] as const;
export const leadInput = z.object({
  name: z.string().trim().min(2).max(100),
  phone: z
    .string()
    .trim()
    .regex(/^\+?[\d ()-]{7,25}$/)
    .transform((v) => v.replace(/[ ()-]/g, ""))
    .refine((v) => /^\+?\d{7,15}$/.test(v), "Use 7–15 digits"),
  email: z
    .union([z.email().max(254), z.literal("")])
    .optional()
    .transform((v) => (v ? v.toLowerCase() : null)),
  source: z.enum(sources),
});
export const appointmentStatus = z.enum([
  "SCHEDULED",
  "CONFIRMED",
  "CHECKED_IN",
  "COMPLETED",
  "CANCELLED",
  "NO_SHOW",
]);
export const followUpStatus = z.enum(["OPEN", "DONE", "CANCELLED"]);
const instant = z.iso.datetime({ offset: true }).transform((v) => new Date(v));
export const appointmentInput = z
  .object({
    resource: z
      .string()
      .trim()
      .min(2)
      .max(80)
      .transform((v) => v.toLowerCase().replace(/\s+/g, " ")),
    startsAt: instant,
    endsAt: instant,
  })
  .refine(
    (v) =>
      v.endsAt > v.startsAt &&
      v.endsAt.getTime() - v.startsAt.getTime() <= 8 * 3600000,
    "End must be after start and within eight hours",
  );
export const followUpInput = z.object({
  title: z.string().trim().min(2).max(160),
  dueAt: instant,
});
export const leadQuery = z.object({
  search: z.string().trim().max(100).default(""),
  status: z.union([leadStatus, z.literal("")]).default(""),
  page: z.coerce.number().int().min(1).max(100000).default(1),
});
