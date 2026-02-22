# Layer Compliance Standards — Skill

Architectural import rules for the ui-next codebase.
Loaded by the `layer-compliance-enforcer` at Step 0.

---

## 1. The Layer Architecture

```
src/app/(dashboard)/[feature]/     ← Feature routes (page, layout, hooks, components)
         ↓ imports from
src/components/                     ← Shared UI components
         ↓ imports from
src/hooks/                          ← Shared hooks
src/stores/                         ← Global state
         ↓ imports from
src/lib/api/adapter/                ← Adapter layer (transforms backend → UI types)
         ↓ imports from
src/lib/api/generated.ts            ← Auto-generated API types and hooks (read-only source)
```

**Traffic flows downward only.** Violations are imports that go sideways or upward.

---

## 2. The Five Violation Types

### V1 — Feature-to-Feature Imports (CRITICAL)

Features must not import from each other. Each feature is an isolated vertical slice.

```typescript
// ❌ BAD: pools feature imports from workflows feature
// src/app/(dashboard)/pools/use-pools-page.ts
import { useWorkflowsData } from "@/app/(dashboard)/workflows/use-workflows-data";

// ✅ GOOD: extract shared logic to src/hooks/ or src/lib/
import { useSharedResource } from "@/hooks/use-shared-resource";
```

**Detection:**
```
Grep: pattern="from ['\"]@/app/\(dashboard\)/\w+" glob="src/app/(dashboard)/**/*.{ts,tsx}"
```
Then filter: source file's feature dir ≠ imported path's feature dir → violation.

**Auto-fix:** SKIP — requires extracting shared logic, needs human judgment.

---

### V2 — Direct Generated Type/Hook Import (CRITICAL)

All API interaction must go through the adapter layer. Direct imports from `generated.ts`
are only allowed inside `src/lib/api/adapter/`.

```typescript
// ❌ BAD: component imports generated hook directly
// src/components/pools-table/pools-table.tsx
import { useGetPools } from "@/lib/api/generated";

// ✅ GOOD: use the adapter hook
import { usePools } from "@/lib/api/adapter/pools";
```

**Exception:** Enum imports from `generated.ts` are allowed everywhere:
```typescript
// ✅ ALLOWED: enums come from generated
import { PoolStatus, WorkflowStatus } from "@/lib/api/generated";
```

**Detection:**
```
Grep: pattern="from ['\"]@/lib/api/generated['\"]" glob="src/**/*.{ts,tsx}" output_mode="content"
```
Then filter lines that don't only import enum types. Heuristic: if the import includes
function names starting with `use` (hooks) → violation. If only PascalCase identifiers
that end in `Status`, `Priority`, `Type` → allowed.

**Auto-fix:** Replace `import { useX } from "@/lib/api/generated"` with the correct
adapter import. Read `src/lib/api/adapter/` to find the right adapter file.

---

### V3 — Components Importing from App Routes (HIGH)

Shared components must not know about feature-specific logic. The dependency direction
must be features → components, never the reverse.

```typescript
// ❌ BAD: shared component imports from a feature
// src/components/data-table/data-table.tsx
import { usePoolsConfig } from "@/app/(dashboard)/pools/use-pools-config";

// ✅ GOOD: accept config as props
// Consumer (pools page) passes config to data-table via props
```

**Detection:**
```
Grep: pattern="from ['\"]@/app/" glob="src/components/**/*.{ts,tsx}"
```

**Auto-fix:** SKIP — requires prop lifting, needs human judgment.

---

### V4 — Barrel Exports (HIGH)

`index.ts` and `index.tsx` files that re-export from other modules are forbidden.
All imports must be direct to source files (perfect tree shaking, fast HMR, RSC safety).

```typescript
// ❌ BAD: src/components/index.ts
export { DataTable } from "./data-table/data-table";
export { Panel } from "./panel/panel";

// ❌ BAD: any import from a barrel
import { DataTable } from "@/components";

// ✅ GOOD: direct imports only
import { DataTable } from "@/components/data-table/data-table";
```

**Detection:**
```
Glob: src/**/index.ts
Glob: src/**/index.tsx
```
For each found, read and check if it contains `export` statements → violation.

**Auto-fix:** Delete the barrel file. Find all importers of the barrel path and
update them to direct import paths. This IS auto-fixable if the barrel is simple
(only re-exports, no own logic).

---

### V5 — Relative Imports (MEDIUM)

All imports must use absolute `@/` paths. Relative imports (`./`, `../`) are forbidden.

```typescript
// ❌ BAD
import { Panel } from "./panel";
import { useCopy } from "../hooks/use-copy";

// ✅ GOOD
import { Panel } from "@/components/panel/panel";
import { useCopy } from "@/hooks/use-copy";
```

**Detection:**
```
Grep: pattern="from ['\"]\.\.?/" glob="src/**/*.{ts,tsx}" output_mode="content"
```

**Auto-fix:** Convert relative import to absolute `@/` path by resolving the
relative path against the source file's location.

---

## 3. Priority Order

When multiple violations exist, fix in this order:

1. **V1 (Feature→Feature)** — CRITICAL, highest architectural impact, SKIP to human
2. **V2 (Generated direct import)** — CRITICAL, breaks type safety contract, auto-fix hooks
3. **V3 (Component→App)** — HIGH, direction violation, SKIP to human
4. **V4 (Barrel exports)** — HIGH, tree-shaking bloat, auto-fix simple barrels
5. **V5 (Relative imports)** — MEDIUM, tooling issue, always auto-fixable

---

## 4. Auto-Fix Decision Matrix

| Violation | Auto-fixable? | Notes |
|-----------|--------------|-------|
| V1 | ❌ SKIP | Requires extracting shared logic |
| V2 (hooks) | ✅ YES | Find adapter equivalent, swap import |
| V2 (enums only) | N/A | Not a violation |
| V3 | ❌ SKIP | Requires prop lifting |
| V4 (simple re-export) | ✅ YES | Delete barrel, update importers |
| V4 (with own logic) | ❌ SKIP | Barrel has code, not just re-exports |
| V5 | ✅ YES | Resolve relative → absolute |

---

## 5. Finding the Correct Adapter Import

When fixing V2 (direct generated.ts import), find the right adapter:

```
Glob: src/lib/api/adapter/*.ts
```

For each adapter file, check what hooks it exports:
```
Grep: pattern="export function use\w+" glob="src/lib/api/adapter/*.ts" output_mode="content"
```

Match the generated hook name to its adapter equivalent:
- `useGetPools` (generated) → `usePools` (adapter/pools.ts)
- `useListWorkflows` (generated) → `useWorkflows` (adapter/workflows.ts)
- `useGetResources` (generated) → `useResources` (adapter/resources.ts)

If no adapter equivalent exists → SKIP, add to skipped list with note "no adapter found".
