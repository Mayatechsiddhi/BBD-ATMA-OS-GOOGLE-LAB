import { expect, it } from "vitest";
import {
  nextStatuses,
  validateTransition,
} from "../../src/modules/crm/workflow";
import { contactInput } from "../../src/modules/crm/validation";
import type { ContactStatus } from "../../src/generated/prisma/enums";
for (const from of Object.keys(nextStatuses) as ContactStatus[]) {
  for (const to of Object.keys(nextStatuses) as ContactStatus[]) {
    it(`client workflow ${from} -> ${to}`, () => {
      if (nextStatuses[from].includes(to))
        expect(() => validateTransition(from, to)).not.toThrow();
      else
        expect(() => validateTransition(from, to)).toThrow(
          "Invalid client workflow transition",
        );
    });
  }
}
it("validates contact data and normalizes email", () => {
  expect(
    contactInput.parse({
      name: "Client Name",
      email: "CLIENT@example.com",
      company: " ",
    }),
  ).toEqual({
    name: "Client Name",
    email: "client@example.com",
    company: null,
  });
  expect(contactInput.safeParse({ name: "x", email: "invalid" }).success).toBe(
    false,
  );
});
