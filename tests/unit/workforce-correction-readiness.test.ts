import { expect, it, vi } from "vitest";
import type { Prisma } from "../../src/generated/workforce/client";
import { assertWorkforceRuntime } from "../../src/modules/workforce-control-plane/database";
it.each([false, undefined])(
  "rejects an old/incomplete workforce correction schema marker: %s",
  async (corrections) => {
    const query = vi.fn().mockResolvedValue([
      {
        unsafe: false,
        protected: 5,
        customer: false,
        functionDrift: false,
        corrections,
      },
    ]);
    await expect(
      assertWorkforceRuntime({
        $queryRaw: query,
      } as unknown as Prisma.TransactionClient),
    ).rejects.toThrow("Unsafe workforce runtime database");
    expect(query).toHaveBeenCalledOnce();
  },
);
