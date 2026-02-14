# CLAUDE.md

This file provides guidance to Claude Code when working with this Next.js 16 + React 19 codebase.

## 🚨 CRITICAL - Verification Before Declaring Done

**Before saying "Done", "Fixed", "Complete", or reporting success, ALWAYS run:**

```bash
cd external/ui-next && pnpm type-check && pnpm lint && pnpm test --run
```

**All checks must pass with ZERO errors and ZERO warnings.** If any check fails, fix immediately and re-run ALL checks.

**When fixing errors:**
- ❌ NEVER suppress with `@ts-ignore` or `eslint-disable`
- ❌ NEVER use `any` type
- ✅ ALWAYS resolve the root cause properly

**After all checks pass:**
```bash
pnpm format
```

## Development Commands

```bash
# Daily workflow
pnpm dev                    # Start dev server
pnpm dev:mock               # Dev with mock data (no backend)

# Code quality
pnpm lint                   # ESLint + React Compiler checks
pnpm type-check             # TypeScript check
pnpm format                 # Prettier format

# Testing
pnpm test                   # Unit tests (Vitest)
pnpm test:e2e:ui            # E2E tests interactive UI
pnpm test:all               # All tests

# API generation
pnpm generate-api           # Regenerate from backend OpenAPI spec
```

## Architecture: The Critical Layer Pattern

```
Page → Headless Hook → Adapter Hook → Generated API → Backend
            ↓
     Themed Components
```

**Critical concept**: The adapter layer (`src/lib/api/adapter/`) transforms backend responses to match UI expectations. The backend has quirks—the adapter bridges the gap.

```typescript
// ❌ DON'T import generated types/hooks directly
import { usePools } from '@/lib/api/generated';

// ✅ DO use adapter hooks and types
import { usePools, type Pool } from '@/lib/api/adapter/pools';
import { useResources, type Resource } from '@/lib/api/adapter/resources';
import { useWorkflows } from '@/lib/api/adapter/workflows';

// ✅ Enums MUST come from generated for type safety
import { PoolStatus, WorkflowStatus, WorkflowPriority } from '@/lib/api/generated';
```

**See `src/lib/api/adapter/BACKEND_TODOS.md`** for 22 backend issues and workarounds.

## Import Rules: Absolute + Direct Only

**MANDATORY: All imports MUST use absolute @/ paths. Relative imports are STRICTLY FORBIDDEN.**

```typescript
// ✅ REQUIRED: Absolute imports with @/ prefix
import { Button } from "@/components/shadcn/button";
import { usePoolsData } from "@/app/(dashboard)/pools/use-pools-data";
import { DataTable } from "@/components/data-table/DataTable";

// ❌ FORBIDDEN: Relative imports (ESLint will ERROR)
import { Button } from "./button";
import { Button } from "../shadcn/button";
```

**CRITICAL: All imports must be direct to source files. Barrel exports (index.ts) are forbidden.**

```typescript
// ✅ REQUIRED: Direct imports
import { useCopy } from "@/hooks/use-copy";
import { createTableStore } from "@/stores/create-table-store";

// ❌ FORBIDDEN: Barrel exports
import { useCopy } from "@/hooks";
import { createTableStore } from "@/stores";
```

**Why:** Perfect tree shaking, fast HMR, clear dependencies, RSC safety, Turbopack compatibility.

## Forbidden Patterns

```typescript
// ❌ String literals for enums
if (pool.status === "ONLINE") { ... }

// ✅ Use generated enums
import { PoolStatus } from "@/lib/api/generated";
if (pool.status === PoolStatus.ONLINE) { ... }
```

```typescript
// ❌ Manual fetch patterns
const [data, setData] = useState(null);
useEffect(() => { fetch(...).then(setData); }, []);

// ✅ TanStack Query via adapter
const { pools, isLoading } = usePools();
```

```typescript
// ❌ CRITICAL BUG: Returning new objects every render
function useConfig() {
  const [value] = useQueryState("key");
  return {
    params: { key: value },  // NEW object every render!
  };
}

// ✅ Memoize returned objects
function useConfig() {
  const [value] = useQueryState("key");
  const params = useMemo(() => ({ key: value }), [value]);
  return { params };
}
// WHY: React Query uses object refs in query keys. New objects → cascading re-renders, canceled requests.
```

```typescript
// ❌ Non-semantic interactive elements
<div onClick={handleClick}>Click me</div>

// ✅ Semantic HTML or shadcn components
<Button onClick={handleClick}>Click me</Button>
```

```typescript
// ❌ setState during render (causes infinite loop)
function Component({ data }) {
  const [processed, setProcessed] = useState(null);
  if (data && !processed) {
    setProcessed(transform(data)); // BAD!
  }
  return <div>{processed}</div>;
}

// ✅ Use derived state
function Component({ data }) {
  const processed = useMemo(() => data ? transform(data) : null, [data]);
  return <div>{processed}</div>;
}
```

```typescript
// ❌ Dual state sources for same UI concern
const [isOpen, setIsOpen] = useState(false);
const [urlOpen] = useQueryState('open');
// Which is source of truth?

// ✅ Single source of truth
const [isOpen, setIsOpen] = useQueryState('open');
```

## Code Simplification Standards

When refactoring or reviewing code, apply these standards:

### Dead Code vs Redundant Code

- **Dead code**: Unused functions/variables (grep can find)
- **Redundant code**: Used but shouldn't exist (requires reasoning)

Both must be removed.

### Challenge Every Abstraction

Every field, function, and type must justify its existence:

```typescript
// ❌ Redundant: trivial derivation stored as state
interface TaskGroup {
  podPhase: PodPhase;           // "Pending" | "Running" | "Succeeded" | "Failed"
  status: TaskStatus;            // "pending" | "running" | "completed" | "failed"
}

// ✅ Single source of truth + helper for UI labels
interface TaskGroup {
  podPhase: PodPhase;            // Only canonical field
}
function getStatusLabel(phase: PodPhase): string { /* ... */ }
```

### Anti-Patterns to Detect

- **Derived fields from trivial transformations**: If it's a simple `switch`/`map`, make it a helper function
- **Multiple representations of same concept**: Pick one canonical representation (prefer the standard/upstream one)
- **Stored computed values**: If cheap to compute, derive on-demand
- **Intermediate values as fields**: Only store if expensive to recompute or needed for reconciliation

### When to Store vs Compute

**Store** if:
- Expensive to compute repeatedly
- Needed for time-travel/history
- Required for reconciliation logic
- Comes from external source (API, user input)

**Compute** if:
- Cheap transformation (O(1) switch/map)
- Always derivable from other fields
- Only used in one place
- Makes testing simpler

### Refactoring Checklist

Before declaring code "clean":

1. ✅ Removed dead code (unused references)
2. ✅ Removed redundant code (unjustified abstractions)
3. ✅ Single source of truth for each concept
4. ✅ Derived values are helpers, not fields (unless justified)
5. ✅ Challenged every field: "Could consumers compute this inline?"

## Styling Architecture & Tailwind Best Practices

**Use the `tailwind-css-architect` agent proactively to review styling code for anti-patterns.**

### When to Use tailwind-css-architect

Launch this agent when:
- Building new components with significant styling logic
- Reviewing code that computes CSS classes in JavaScript
- Refactoring styling patterns for consistency
- After writing styling-heavy features (modals, tables, cards, layouts)

### Styling Anti-Patterns to Detect

**❌ JavaScript functions returning class strings:**
```typescript
// BAD: Mixing styling logic with JavaScript
export function getBadgeClass(status: string): string {
  if (status === "error") return "bg-red-100 text-red-800";
  if (status === "warn") return "bg-yellow-100 text-yellow-800";
  return "bg-gray-100 text-gray-800";
}
```

**✅ Data attributes + CSS selectors:**
```typescript
// GOOD: Separation of concerns
<span className="badge" data-status={status}>
```
```css
.badge[data-status="error"] { @apply bg-red-100 text-red-800; }
.badge[data-status="warn"] { @apply bg-yellow-100 text-yellow-800; }
.badge { @apply bg-gray-100 text-gray-800; }
```

**Why this is better:**
- Separation of concerns (styling in CSS, not JS)
- Single source of truth for all badge styles
- Easier to test (CSS is independent)
- More semantic (data describes WHAT, CSS describes HOW)
- Follows Tailwind 4's CSS-first approach

### CSS Variables: Single Source of Truth

**❌ Duplicating values in multiple CSS properties:**
```css
/* BAD: Same values defined twice - can get out of sync */
.scroll-inner {
  min-width: 660px; /* 150 + 50 + 100 + 300 + 60 */
}
.grid {
  grid-template-columns: minmax(150px, 1fr) 50px 100px minmax(300px, 2fr) 60px;
}
```

**✅ Use CSS custom properties for shared values:**
```css
/* GOOD: Single source of truth */
:root {
  --col-task-min: 150px;
  --col-retry: 50px;
  --col-duration: 100px;
  --col-lifecycle-min: 300px;
  --col-events: 60px;
}

.scroll-inner {
  min-width: calc(
    var(--col-task-min) + var(--col-retry) + var(--col-duration) +
      var(--col-lifecycle-min) + var(--col-events)
  );
}

.grid {
  grid-template-columns:
    minmax(var(--col-task-min), 1fr)
    var(--col-retry)
    var(--col-duration)
    minmax(var(--col-lifecycle-min), 2fr)
    var(--col-events);
}
```

**Why this is better:**
- Single source of truth - can't get out of sync
- Clear variable names document intent
- Easy to adjust values globally
- No comments needed to explain magic numbers
- Follows DRY (Don't Repeat Yourself) principle

**When to use CSS variables:**
- Values used in multiple CSS properties
- Values that might need to be adjusted together
- Values that need to be calculated or combined (with `calc()`)
- Component-specific spacing/sizing that differs from global design tokens

### Other Anti-Patterns

- **Inline style objects** → Tailwind utilities or CSS variables
- **Magic color/spacing values** → CSS variables in `globals.css`
- **Computed styles in render** → CSS custom properties with inline styles
- **Style logic mixed with business logic** → Extract to semantic CSS classes

### Styling Checklist

Before declaring styling code "clean":

1. ✅ No JavaScript functions returning class strings (use data attributes + CSS)
2. ✅ No inline `style` objects (use Tailwind or CSS variables)
3. ✅ No magic values (use CSS variables from `globals.css`)
4. ✅ No duplicated values in CSS (use CSS custom properties for shared values)
5. ✅ Styling concerns separated from business logic
6. ✅ GPU-accelerated animations (transform/opacity, not width/height)

## Production/Mock Code Separation

**NEVER add mock-related code to production source files.**

- ❌ NEVER import from `src/mocks/` in production files
- ❌ NEVER add `if (process.env.NODE_ENV === 'development')` mock checks
- ✅ Use aliasing, separate entry points, build-time substitution

**Why:** Security vulnerabilities, bundle bloat, runtime errors.

## SSR/Hydration Safety

**localStorage + SSR = hydration mismatches.** Server renders default state, client has different localStorage values.

```tsx
// ❌ FORBIDDEN: Direct store access for persisted values
const displayMode = useSharedPreferences((s) => s.displayMode);

// ✅ REQUIRED: Use hydration-safe selectors from @/stores
import { useDisplayMode, useCompactMode, useSidebarOpen } from "@/stores";
const displayMode = useDisplayMode();
```

```tsx
// ❌ FORBIDDEN: Locale-dependent formatting during SSR
date.toLocaleString();

// ✅ REQUIRED: SSR-safe formatters
import { formatDateTimeFull, formatDateTimeSuccinct } from "@/lib/format-date";
formatDateTimeFull(date);
```

```tsx
// ❌ FORBIDDEN: Radix components without hydration guard
return <DropdownMenu>...</DropdownMenu>;

// ✅ REQUIRED: Guard with useMounted
import { useMounted } from "@/hooks";
const mounted = useMounted();
if (!mounted) return <Button disabled>...</Button>;
return <DropdownMenu>...</DropdownMenu>;
```

## Debugging React Issues: Check These First

| Symptom | Root Cause | Where to Look |
|---------|------------|---------------|
| Infinite re-render loop | setState during render | Component body, useMemo without deps |
| "Cannot nest buttons" error | Nested interactive elements | Button/Link with children |
| Flashing/jank after mutation | Unnecessary cache revalidation | revalidatePath calls |
| State resets unexpectedly | Dual state sources | useState + URL state |
| Hydration mismatch | SSR differs from client | localStorage, Date.now(), random values |

**Animation/Layout issues:** Don't shotgun CSS changes. Add debug instrumentation FIRST to identify root cause, then apply ONE targeted fix, then verify.

## Single Source of Truth

| What | Source | NOT |
|------|--------|-----|
| API types | `@/lib/api/adapter/` | `@/lib/api/generated.ts` |
| Enums ONLY | `@/lib/api/generated.ts` | String literals |
| Row heights, spacing | `useConfig()` → `table.rowHeights` | Magic numbers |
| CSS variables | `globals.css` | Inline hex colors |
| Clipboard operations | `useServices().clipboard` | `navigator.clipboard` |
| URL state | `usePanelState()`, `useUrlChips()` | Raw `useSearchParams` |

## Performance Requirements

| Scenario | MUST Use | Reason |
|----------|----------|--------|
| Lists > 50 items | TanStack Virtual + `contain-strict` | Prevent DOM bloat |
| Search inputs | `useDeferredValue` | Don't block typing |
| Heavy state updates | `startTransition` | Keep UI responsive |

**Animation rules:**
- ✅ Animate: `transform`, `opacity` (GPU-accelerated)
- ❌ NEVER animate: `width`, `height`, `margin`, `padding` (causes reflow)

## Accessibility Requirements

All interactive elements MUST be keyboard accessible (Enter/Space/Escape/Tab/Arrows).

```tsx
// ✅ Screen reader announcements for dynamic changes
const { announcer } = useServices();
announcer.announce("Copied to clipboard", "polite");
```

## Check Existing Components First

**Before creating ANY component, search these locations:**

| Need | Check First |
|------|-------------|
| UI primitives | `@/components/shadcn/` |
| Composed components | `@/components/` (DataTable, SmartSearch, Panel) |
| Hooks | `@/hooks/` (useCopy, useAnnouncer, usePanelState) |
| Utilities | `@/lib/utils.ts` |
| Library hooks | `usehooks-ts`, `@react-hookz/web` |

**Rule: If it exists, USE it. If it's close, EXTEND it. Only then CREATE.**

## Code Style

### File Naming
- **Components**: `PascalCase.tsx` (e.g., `Button.tsx`, `DataTable.tsx`)
  - Exception: shadcn/ui uses `kebab-case.tsx` (external library)
- **Hooks**: `camelCase.ts` with `use` prefix (e.g., `useAuth.ts`)
- **Utilities**: `camelCase.ts` (e.g., `formatDate.ts`, `utils.ts`)

### Copyright Headers

**ALL new `.ts`/`.tsx` files MUST include:**

```typescript
//SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION. All rights reserved.

//Licensed under the Apache License, Version 2.0 (the "License");
//you may not use this file except in compliance with the License.
//You may obtain a copy of the License at

//http://www.apache.org/licenses/LICENSE-2.0

//Unless required by applicable law or agreed to in writing, software
//distributed under the License is distributed on an "AS IS" BASIS,
//WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//See the License for the specific language governing permissions and
//limitations under the License.

//SPDX-License-Identifier: Apache-2.0
```

**Skip for:** Config files, package.json, generated files.

## Important Files

| File | Purpose |
|------|---------|
| `src/lib/api/adapter/BACKEND_TODOS.md` | **READ FIRST** - 22 backend issues |
| `src/lib/api/adapter/README.md` | Adapter layer philosophy |
| `src/lib/auth/README.md` | Auth setup (Envoy prod, local dev) |
| `src/app/(dashboard)/pools/` | Reference feature module |

## Tech Stack

- **Framework**: Next.js 16 (App Router, Turbopack, PPR)
- **UI**: React 19, Tailwind CSS 4, shadcn/ui
- **State**: TanStack Query 5, Zustand (minimal)
- **Testing**: Vitest (unit), Playwright (E2E)
- **Mocking**: MSW (dev), Playwright route mocking (E2E)

## Final Verification Checklist

Before submitting code:

- [ ] `pnpm type-check && pnpm lint && pnpm test --run` with ZERO errors/warnings?
- [ ] Checked `@/components/` before creating new component?
- [ ] ALL imports using absolute @/ paths (NO `./` or `../`)?
- [ ] ALL imports direct to source files (NO barrel exports)?
- [ ] Types from `@/lib/api/adapter`, enums from `@/lib/api/generated`?
- [ ] Using enum values (e.g., `PoolStatus.ONLINE`) not strings (`"ONLINE"`)?
- [ ] Every interactive element keyboard accessible?
- [ ] Using TanStack/Zustand/nuqs instead of manual state?
- [ ] No magic numbers (use constants/config)?
- [ ] All NEW files have NVIDIA copyright header?
- [ ] Ran `pnpm format` after checks passed?

**If any answer is NO, fix it before proceeding.**
