import { z } from "zod";
export class OpportunityError extends Error {}
export const stages = ["OPEN", "PROPOSAL", "WON", "LOST"] as const;
export const stageInput = z.enum(stages);
export const opportunityNext: Record<string, readonly string[]> = {
  OPEN: ["PROPOSAL", "LOST"],
  PROPOSAL: ["WON", "LOST"],
  WON: [],
  LOST: [],
};
export const opportunityInput = z.object({
  contactId: z.string().regex(/^[A-Za-z0-9_-]{1,100}$/),
  title: z.string().trim().min(2).max(160),
  amount: z
    .string()
    .regex(/^(0|[1-9]\d{0,7})(\.\d{1,2})?$/)
    .transform((v) => {
      const [whole, fraction = ""] = v.split(".");
      return Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
    })
    .refine((v) => v <= 1000000000, "Maximum value is INR 1,00,00,000"),
  requestKey: z.uuid().transform((v) => v.toLowerCase()),
});
export const opportunityQuery = z.object({
  search: z.string().trim().max(100).default(""),
  stage: z.union([stageInput, z.literal("")]).default(""),
  page: z.coerce.number().int().min(1).max(100000).default(1),
});
