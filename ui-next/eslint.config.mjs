import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Auto-generated API client
    "src/lib/api/generated.ts",
    // E2E tests (Playwright, not React)
    "e2e/**",
    // Vendored/third-party code
    "public/**",
  ]),
  // Custom rules
  {
    rules: {
      // Allow unused variables/args that start with underscore
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
    },
  },
  // Prevent production code from importing experimental code
  // Experimental code can import production code, but not vice versa
  {
    ignores: ["src/app/**/experimental/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/experimental/**", "@/app/**/experimental/**"],
              message:
                "Production code must not import from /experimental. Only experimental code may import production code.",
            },
          ],
        },
      ],
    },
  },
]);

export default eslintConfig;
