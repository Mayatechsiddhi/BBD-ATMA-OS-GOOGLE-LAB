import { z } from "zod";
export const contactInput = z.object({
  name: z.string().trim().min(2).max(100),
  email: z
    .email()
    .max(254)
    .transform((v) => v.toLowerCase()),
  company: z
    .string()
    .trim()
    .max(150)
    .optional()
    .transform((v) => v || null),
});
export const contactStatus = z.enum([
  "LEAD",
  "QUALIFIED",
  "CUSTOMER",
  "ARCHIVED",
]);
