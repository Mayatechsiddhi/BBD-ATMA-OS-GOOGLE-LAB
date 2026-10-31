import { defineConfig, globalIgnores } from "eslint/config";
import next from "eslint-config-next/core-web-vitals";
import ts from "eslint-config-next/typescript";
export default defineConfig([
  ...next,
  ...ts,
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/modules/internal-workforce/**", "src/generated/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/internal-workforce", "**/internal-workforce/**"],
              message:
                "Synthetic workforce mock must not enter application code.",
            },
          ],
        },
      ],
    },
  },
  globalIgnores([".next/**", "next-env.d.ts", "src/generated/**"]),
]);
