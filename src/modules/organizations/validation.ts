import { z } from "zod";
export const organizationInput = z.object({
  name: z.string().trim().min(2).max(100),
  slug: z
    .string()
    .trim()
    .min(3)
    .max(50)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
});
export const inviteInput = z.object({
  email: z
    .email()
    .max(254)
    .transform((v) => v.toLowerCase()),
  role: z.enum(["ADMIN", "MEMBER"]),
});
export const memberRole = z.enum(["OWNER", "ADMIN", "MEMBER"]);
export const tokenInput = z.string().regex(/^[a-f0-9]{64}$/);
