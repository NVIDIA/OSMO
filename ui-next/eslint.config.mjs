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
  // Feature Module Boundaries
  // ============================================================================
  // Enforce clean imports across feature boundaries.
  // Features should import from each other's public API (index.ts), not internals.
  //
  // Good: import { usePoolsData } from "@/app/(dashboard)/pools";
  // Bad:  import { usePoolsData } from "@/app/(dashboard)/pools/hooks/use-pools-data";
  //
  // This is currently a warning to allow gradual migration.
  // TODO: Upgrade to "error" once all deep imports are eliminated.
  {
    files: ["src/app/**/*.ts", "src/app/**/*.tsx"],
    rules: {
      "no-restricted-imports": [
        "warn",
        {
          patterns: [
            // Warn on deep imports into pools feature internals
            {
              group: [
                "@/app/(dashboard)/pools/hooks/*",
                "@/app/(dashboard)/pools/lib/*",
                "@/app/(dashboard)/pools/stores/*",
                "@/app/(dashboard)/pools/components/**/*",
              ],
              message:
                "Import from feature's public API: import { ... } from '@/app/(dashboard)/pools'. Deep imports couple modules too tightly.",
            },
            // Warn on deep imports into resources feature internals
            {
              group: [
                "@/app/(dashboard)/resources/hooks/*",
                "@/app/(dashboard)/resources/lib/*",
                "@/app/(dashboard)/resources/stores/*",
                "@/app/(dashboard)/resources/components/**/*",
              ],
              message:
                "Import from feature's public API: import { ... } from '@/app/(dashboard)/resources'. Deep imports couple modules too tightly.",
            },
            // Warn on deep imports into workflows feature internals
            {
              group: [
                "@/app/(dashboard)/workflows/hooks/*",
                "@/app/(dashboard)/workflows/lib/*",
                "@/app/(dashboard)/workflows/stores/*",
                "@/app/(dashboard)/workflows/components/**/*",
              ],
              message:
                "Import from feature's public API: import { ... } from '@/app/(dashboard)/workflows'. Deep imports couple modules too tightly.",
            },
          ],
        },
      ],
    },
  },
]);

export default eslintConfig;
