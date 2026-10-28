import { z } from "zod";
import { clinicDate, dayRange } from "@/modules/clinic/time";
export const doctorInput = z.object({
  name: z.string().trim().min(2).max(100),
  room: z.string().trim().min(1).max(40),
  resource: z
    .string()
    .trim()
    .min(2)
    .max(80)
    .transform((v) => v.toLowerCase().replace(/\s+/g, " ")),
});
export const queueAction = z.enum([
  "CALL",
  "RECALL",
  "SKIP",
  "COMPLETE",
  "CANCEL",
]);
export const queueTransitions = {
  WAITING: ["CALL", "SKIP", "CANCEL"],
  CALLED: ["RECALL", "SKIP", "COMPLETE", "CANCEL"],
  SKIPPED: ["CALL", "CANCEL"],
  COMPLETED: [],
  CANCELLED: [],
} as const;
export const queueQuery = z.object({
  day: z
    .string()
    .refine((v) => {
      try {
        dayRange(v);
        return true;
      } catch {
        return false;
      }
    }, "Invalid queue day")
    .default(() => clinicDate()),
  doctorId: z.string().max(100).default(""),
  patientPage: z.coerce.number().int().min(1).max(100000).default(1),
  page: z.coerce.number().int().min(1).max(100000).default(1),
  search: z.string().trim().max(100).default(""),
});
