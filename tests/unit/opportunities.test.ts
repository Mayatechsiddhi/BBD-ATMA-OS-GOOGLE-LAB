import { describe, it, expect } from "vitest";
import {
  opportunityInput,
  opportunityQuery,
  opportunityNext,
} from "../../src/modules/crm/opportunity-rules";
const input = {
  contactId: "contact",
  title: "Synthetic consultation package",
  amount: "2500.05",
  requestKey: "12345678-1234-4234-9234-123456789abc",
};
describe("opportunity input and lifecycle", () => {
  it("keeps INR values exact as integer paise", () => {
    expect(opportunityInput.parse(input).amount).toBe(250005);
    expect(opportunityInput.parse({ ...input, amount: "0.01" }).amount).toBe(1);
    expect(
      opportunityInput.parse({ ...input, amount: "10000000.00" }).amount,
    ).toBe(1000000000);
  });
  it("rejects negative, over-precision, exponential, malformed and oversized amounts", () => {
    for (const amount of [
      "-1",
      "1.001",
      "1e3",
      "NaN",
      "01.00",
      "10000000.01",
      "100000000",
    ])
      expect(opportunityInput.safeParse({ ...input, amount }).success).toBe(
        false,
      );
  });
  it("requires bounded contact, title, nonce and filters", () => {
    for (const change of [
      { contactId: "../foreign" },
      { title: "x" },
      { requestKey: "invalid" },
    ])
      expect(opportunityInput.safeParse({ ...input, ...change }).success).toBe(
        false,
      );
    expect(opportunityQuery.safeParse({ page: 0 }).success).toBe(false);
    expect(opportunityQuery.safeParse({ stage: "OWNER" }).success).toBe(false);
  });
  it("does not skip proposal or reopen terminal deals", () => {
    expect(opportunityNext.OPEN).toEqual(["PROPOSAL", "LOST"]);
    expect(opportunityNext.PROPOSAL).toEqual(["WON", "LOST"]);
    expect(opportunityNext.WON).toEqual([]);
    expect(opportunityNext.LOST).toEqual([]);
  });
});
