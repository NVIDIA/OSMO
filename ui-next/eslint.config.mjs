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
  // ============================================================================
  // CRITICAL: Single-Use Session APIs
  // ============================================================================
  // Prevent direct use of generated exec/portforward hooks.
  // These APIs generate SINGLE-USE session tokens that must never be cached.
  // Always use adapter hooks that ensure unique mutation keys.
  {
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "useExecIntoTaskApiWorkflowNameExecTaskTaskNamePost",
                "usePortForwardTaskApiWorkflowNamePortforwardTaskNamePost",
                "usePortForwardWebserverApiWorkflowNameWebserverTaskNamePost",
              ],
              importNames: [
                "useExecIntoTaskApiWorkflowNameExecTaskTaskNamePost",
                "usePortForwardTaskApiWorkflowNamePortforwardTaskNamePost",
                "usePortForwardWebserverApiWorkflowNameWebserverTaskNamePost",
              ],
              message:
                "CRITICAL: Do not use generated exec/portforward hooks directly. These APIs generate single-use session tokens that must never be cached. Import from '@/lib/api/adapter' instead: useExecIntoTask, usePortForwardTask, usePortForwardWebserver",
            },
          ],
        },
      ],
    },
  },
  // ============================================================================
  // Prevent Barrel Exports (index.ts files)
  // ============================================================================
  // Barrel exports cause tree-shaking failures, HMR issues, and RSC boundary
  // confusion. All imports must be direct to the source file.
  //
  // Good: import { Button } from "@/components/shadcn/button";
  // Bad:  import { Button } from "@/components/shadcn";
  //
  // This is enforced as an error to prevent regression after full migration.
  {
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/index", "**/index.ts", "**/index.tsx"],
              message:
                "Barrel exports (index.ts) are forbidden. Import directly from the source file. Example: import { Button } from '@/components/shadcn/button' (not '@/components/shadcn')",
            },
          ],
        },
      ],
    },
  },
]);

export default eslintConfig;
