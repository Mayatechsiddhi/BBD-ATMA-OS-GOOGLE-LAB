import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    include: ["tests/workforce-browser/**/*.test.ts"],
    testTimeout: 30000,
    fileParallelism: false,
  },
});
