import { isIP } from "node:net";
import { describe, it, expect } from "vitest";
import { browserClientIP } from "../../scripts/browser-client-ip";
describe("synthetic browser network identity", () => {
  it("assigns each user a distinct valid documentation-range /64", () => {
    const addresses = [1, 2, 3, 4].map((client) =>
      browserClientIP("a1b2c3d4-example-run", client),
    );
    expect(
      addresses.every((ip) => isIP(ip) === 6 && ip.startsWith("2001:db8:")),
    ).toBe(true);
    expect(
      new Set(addresses.map((ip) => ip.split(":").slice(0, 4).join(":"))).size,
    ).toBe(4);
    expect(browserClientIP("a1b2c3d4-example-run", 1)).toBe(addresses[0]);
  });
  it("rejects invalid fixture inputs rather than falling back to a shared identity", () => {
    for (const index of [0, -1, 1.5, 65536])
      expect(() => browserClientIP("a1b2", index)).toThrow();
    expect(() => browserClientIP("not-an-ip", 1)).toThrow();
  });
});
