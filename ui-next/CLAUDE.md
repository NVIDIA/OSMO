# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

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

**After all checks pass, format the code:**
```bash
pnpm format
```

## Development Commands

### Daily Workflow
```bash
pnpm dev                    # Start dev server (default backend from .env.local)
pnpm dev:local              # Dev server → localhost:8000
pnpm dev:mock               # Dev with mock data (no backend needed!)
```

### Code Quality
```bash
pnpm lint                   # ESLint (includes React Compiler checks)
pnpm type-check             # TypeScript check
pnpm format                 # Prettier format

# Before commit
pnpm type-check && pnpm lint && pnpm test && pnpm build
```

### Testing
```bash
# Unit tests (Vitest)
pnpm test                   # Run once
pnpm test:watch             # Watch mode
pnpm test -- transforms     # Filter by name

# E2E tests (Playwright)
pnpm test:e2e               # Headless
pnpm test:e2e:ui            # Interactive UI (best for debugging)
pnpm test:e2e -- auth       # Filter by file name

# Run all tests
pnpm test:all
```

### API Generation
```bash
pnpm generate-api           # Regenerate API client from backend OpenAPI spec
```

This runs from the parent directory (`external/`):
1. `bazel run //src/service:export_openapi` → exports `openapi.json`
2. `bazel run //src/service:export_status_metadata` → generates status metadata
3. `orval` → generates TypeScript client in `src/lib/api/generated.ts`

## Architecture Overview

### Layer Pattern

```
Page → Headless Hook → Adapter Hook → Generated API → Backend
            ↓
     Themed Components
```

**Critical concept**: The UI is designed for an **ideal backend** that doesn't fully exist yet. The adapter layer bridges the gap.

### Directory Structure

```
src/
├── app/                    # Next.js App Router pages
│   ├── (dashboard)/        # Authenticated pages (pools, resources, workflows)
│   ├── auth/               # Auth API routes (handled by Envoy in production)
│   └── api/                # Proxy routes to backend
│
├── components/
│   ├── shadcn/             # shadcn/ui primitives (Button, Input, etc.)
│   ├── shell/              # Layout (Header, Sidebar)
│   ├── data-table/         # Reusable data table with virtualization
│   ├── filter-bar/         # SmartSearch component
│   ├── log-viewer/         # Terminal/log viewer (xterm.js)
│   └── dag/                # Workflow DAG visualization
│
├── lib/
│   ├── api/
│   │   ├── adapter/        # **THE CRITICAL LAYER** - transforms backend → ideal types
│   │   ├── generated.ts    # Auto-generated from OpenAPI (NEVER EDIT)
│   │   └── fetcher.ts      # Auth-aware fetch wrapper
│   ├── auth/               # Authentication logic (Envoy in prod, local dev mode)
│   ├── hooks/              # Shared React hooks
│   └── [utils...]          # Utility functions
│
├── mocks/                  # MSW mock handlers for hermetic dev mode
│   ├── generators/         # Deterministic data generators
│   └── seed/               # Mock configuration
│
└── stores/                 # Zustand stores (minimal global state)
```

### The Adapter Layer (Critical!)

Location: `src/lib/api/adapter/`

**Purpose**: Transforms backend responses that don't match UI expectations.

```typescript
// ❌ DON'T import generated types directly in pages/components
import { usePools } from '@/lib/api/generated';

// ✅ DO use adapter hooks
import { usePools } from '@/lib/api/adapter';
```

**Why it exists**: The backend has quirks (numeric fields as strings, missing pagination, etc.). The adapter transforms responses to what the UI expects. When backend is fixed, remove the transform.

**Key files**:
- `types.ts` - Clean types the UI expects
- `transforms.ts` - Transform functions (**all backend workarounds quarantined here**)
- `hooks.ts` - React Query hooks with automatic transformation
- `BACKEND_TODOS.md` - Documents 22 backend issues and workarounds

**Important**: When adding new API usage, add a transform in `adapter/transforms.ts` if needed, then export a hook from `adapter/hooks.ts`.

### Authentication

**Production**: Handled by Envoy sidecar. Next.js receives `x-osmo-user` header and `Authorization: Bearer <token>`.

**Local Development**: Use `pnpm dev` with `.env.local`:
```bash
NEXT_PUBLIC_OSMO_API_HOSTNAME=staging.example.com
AUTH_CLIENT_SECRET=your-keycloak-secret
```

Open http://localhost:3000 and follow the login prompt to transfer your session.

**See**: `src/lib/auth/README.md` for details.

### Feature Modules

Each feature (`pools`, `resources`, `workflows`) follows this structure:

```
app/(dashboard)/pools/
├── page.tsx                # Next.js page (composition only)
├── hooks/
│   └── use-pools-data.ts   # Business logic, filtering, state (no UI)
├── components/
│   └── pools-table.tsx     # Themed components (presentation only)
├── lib/
│   └── [feature utils]     # Feature-specific utilities
└── index.ts                # Public API exports
```

**Import rule**: Features should import from each other's `index.ts`, not internals. ESLint warns on deep imports.

```typescript
// ✅ Good
import { usePoolsData } from '@/app/(dashboard)/pools';

// ❌ Bad (couples modules too tightly)
import { usePoolsData } from '@/app/(dashboard)/pools/hooks/use-pools-data';
```

### Type Imports: Adapter vs Generated

**Critical distinction:** Import **types** from `adapter`, but **enums** from `generated`:

```typescript
// ❌ FORBIDDEN: Types from generated change without notice
import type { Pool } from "@/lib/api/generated";

// ✅ REQUIRED: Types from adapter are stable
import type { Pool } from "@/lib/api/adapter";

// ✅ REQUIRED: Enums MUST come from generated for type safety
import { PoolStatus, WorkflowStatus, WorkflowPriority } from "@/lib/api/generated";
```

**Why this matters:**
- Backend adds a new status → TypeScript error forces UI update
- No silent failures from typos (`"RUNING"` vs `"RUNNING"`)
- Refactoring is safe (rename in one place, compiler finds all uses)

## Forbidden Patterns - NEVER DO THESE

```typescript
// ❌ FORBIDDEN: String literals for enums
if (pool.status === "ONLINE") { ... }
if (workflow.priority === "HIGH") { ... }
const statuses = ["RUNNING", "COMPLETED"];

// ✅ REQUIRED: Use generated enums for type safety
import { PoolStatus, WorkflowStatus, WorkflowPriority } from "@/lib/api/generated";
if (pool.status === PoolStatus.ONLINE) { ... }
if (workflow.priority === WorkflowPriority.HIGH) { ... }
const statuses = [WorkflowStatus.RUNNING, WorkflowStatus.COMPLETED];
```

```typescript
// ❌ FORBIDDEN: Manual fetch patterns
const [data, setData] = useState(null);
const [loading, setLoading] = useState(true);
useEffect(() => { fetch(...).then(setData); }, []);

// ✅ REQUIRED: TanStack Query via adapter hooks
const { pools, isLoading, error } = usePools();
```

```typescript
// ❌ FORBIDDEN: Non-semantic interactive elements
<div onClick={handleClick}>Click me</div>
<span role="button" onClick={handleClick}>Action</span>

// ✅ REQUIRED: Semantic HTML or shadcn components
<Button onClick={handleClick}>Click me</Button>
<button onClick={handleClick}>Action</button>
```

```tsx
// ❌ FORBIDDEN: Buttons that show only the action (not current state)
<Tooltip>
  <TooltipTrigger asChild>
    <Button onClick={toggleCompactMode}>
      <Rows4 className="size-4" /> {/* Always shows compact icon */}
    </Button>
  </TooltipTrigger>
  <TooltipContent>Switch to compact</TooltipContent>
</Tooltip>

// ✅ REQUIRED: SemiStatefulButton for state-aware toggles
import { SemiStatefulButton } from "@/components/shadcn/semi-stateful-button";
<SemiStatefulButton
  onClick={toggleCompactMode}
  currentStateIcon={compactMode ? <Rows4 /> : <Rows3 />}
  nextStateIcon={compactMode ? <Rows3 /> : <Rows4 />}
  currentStateLabel={compactMode ? "Compact View" : "Comfortable View"}
  nextStateLabel={compactMode ? "Switch to Comfortable" : "Switch to Compact"}
/>
```

```typescript
// ❌ FORBIDDEN: Defining your own enum-like types
type Priority = "HIGH" | "NORMAL" | "LOW";
type Status = "ONLINE" | "OFFLINE";

// ✅ REQUIRED: Derive from generated enums
import { WorkflowPriority, PoolStatus } from "@/lib/api/generated";
type Priority = (typeof WorkflowPriority)[keyof typeof WorkflowPriority];
```

```typescript
// ❌ FORBIDDEN: Hardcoded arrays of enum values
const ALL_STATUSES = ["PENDING", "RUNNING", "COMPLETED", "FAILED"];

// ✅ REQUIRED: Derive from generated enum
import { WorkflowStatus } from "@/lib/api/generated";
const ALL_STATUSES = Object.values(WorkflowStatus);
```

```typescript
// ❌ CRITICAL BUG: Returning new objects every render
// This causes cascading re-renders, canceled requests, and performance issues
function useConfig() {
  const [value] = useQueryState("key");
  return {
    params: { key: value },           // NEW object every render!
    options: { flag: true },          // NEW object every render!
  };
}

// ✅ REQUIRED: Memoize returned objects to stabilize references
function useConfig() {
  const [value] = useQueryState("key");

  // Memoize objects - only create new instance when dependencies change
  const params = useMemo(() => ({ key: value }), [value]);
  const options = useMemo(() => ({ flag: true }), []); // Constant, no deps

  return { params, options };
}

// WHY THIS MATTERS:
// - React Query uses object references in query keys
// - useEffect/useMemo dependencies compare by reference
// - New objects trigger cascading updates even when values are identical
// - Causes: canceled requests, unnecessary re-renders, infinite loops
//
// REAL EXAMPLE from log viewer (caused 3 canceled requests on every render):
// - useScenario() returned new { log_scenario: "streaming" } every render
// - LogViewerContainer received new devParams prop
// - useLogData regenerated query key -> canceled & restarted request
// - useLogTail restarted streaming connection -> canceled & restarted
//
// TanStack Query's structural sharing helps with query RESULTS,
// but cannot fix unstable objects in query KEYS or hook dependencies.
```

## Common Development Tasks

### Adding a New API Endpoint

1. Update backend API
2. Run `pnpm generate-api` to regenerate types
3. Add transform in `src/lib/api/adapter/transforms.ts` (if needed)
4. Add hook in `src/lib/api/adapter/hooks.ts`
5. Export from `src/lib/api/adapter/index.ts`
6. Use in your feature hook or component

### Adding a New Feature Page

1. Create `src/app/(dashboard)/your-feature/page.tsx`
2. Create `src/app/(dashboard)/your-feature/hooks/use-your-feature.ts`
3. Create `src/app/(dashboard)/your-feature/components/`
4. Export from `src/app/(dashboard)/your-feature/index.ts`

### Using Filters with SmartSearch

The `SmartSearch` component provides URL-synced filtering with auto-suggest:

```typescript
import { SmartSearch } from '@/components/filter-bar';

// Define search fields
const searchFields = [
  {
    key: 'pool',
    label: 'Pool',
    type: 'select' as const,
    values: pools.map(p => ({ value: p.name, label: p.name })),
  },
  {
    key: 'status',
    label: 'Status',
    type: 'select' as const,
    values: statusOptions,
  },
];

<SmartSearch
  searchFields={searchFields}
  onChipsChange={(chips) => {
    // Convert chips to filter params
  }}
/>
```

Filters are synced to URL via `nuqs`, making them shareable via link.

### Adding UI Components

```bash
npx shadcn@latest add dialog   # Add from shadcn/ui
```

Components are added to `src/components/shadcn/`. For custom components, add to `src/components/[feature]/`.

### Semi-Stateful Button Pattern

**Design Philosophy:** For buttons that toggle between two states (e.g., "My Workflows" ↔ "All Workflows"), use the **semi-stateful** pattern where the button shows the **current state** by default, then transitions to show the **next state** on hover/focus.

**Why:** This provides clear visual feedback about what state the user is in, while previewing what will happen if they click.

**When to use:**
- View filters (My Workflows ↔ All Workflows)
- Display mode toggles (Available ↔ Used)
- Layout toggles (Compact ↔ Comfortable)
- Any button that switches between two mutually exclusive states

**Implementation:**

```tsx
import { SemiStatefulButton } from "@/components/shadcn/semi-stateful-button";
import { User, Users } from "lucide-react";

// Example: User filter toggle
<SemiStatefulButton
  onClick={toggleShowAllUsers}
  currentStateIcon={showAllUsers ? <Users className="size-4" /> : <User className="size-4" />}
  nextStateIcon={showAllUsers ? <User className="size-4" /> : <Users className="size-4" />}
  currentStateLabel={showAllUsers ? "All Users' Workflows" : "My Workflows"}
  nextStateLabel={showAllUsers ? "Show My Workflows" : "Show All Workflows"}
  aria-label={showAllUsers ? "Currently showing all users' workflows" : "Currently showing my workflows"}
/>
```

**Behavior:**
1. **Default (not hovering):** Shows current state icon + current state label in tooltip
2. **Hover/Focus:** Transitions to next state icon + action label in tooltip
3. **Click:** Executes the action, committing to the new state

**Examples in codebase:**
- `UserToggle` in `workflows-toolbar.tsx` - My Workflows ↔ All Workflows
- `DisplayModeToggle` in `DisplayModeToggle.tsx` - Available ↔ Used
- Compact/Comfortable toggle in `TableToolbar.tsx`

### Check Existing Components First

**Before creating ANY component, search these locations:**

| Need | Check First | Common Files |
|------|-------------|--------------|
| UI primitives | `@/components/shadcn/` | button, dialog, input, select, tooltip, popover |
| Composed components | `@/components/` | DataTable, SmartSearch, Panel, TableToolbar |
| Hooks | `@/hooks/` | useCopy, useAnnouncer, useServices, usePanelState |
| Table stores | `@/stores/` | createTableStore factory |
| Utilities | `@/lib/utils.ts` | cn, formatters, validators |
| Library hooks | `usehooks-ts`, `@react-hookz/web` | useDebounce, useLocalStorage, etc. |

**Rule: If it exists, USE it. If it's close, EXTEND it. Only then CREATE.**

## Backend Integration Notes

### Critical: Backend Has Known Issues

See `src/lib/api/adapter/BACKEND_TODOS.md` for the complete list of 22 backend issues and workarounds.

**High-priority issues**:

1. **Resources API needs pagination** - Currently returns all resources at once. UI shims with client-side pagination. See BACKEND_TODOS.md #11.

2. **Workflow list `more_entries` always false** - Bug in backend pagination logic. UI infers `hasMore` from item count. See BACKEND_TODOS.md #14.

3. **Workflow list `order` parameter ignored** - Backend always fetches DESC then re-sorts. UI shows wrong sort order. See BACKEND_TODOS.md #17.

4. **Response types are wrong** - Several endpoints typed as `string` but return objects. UI casts to `unknown`. See BACKEND_TODOS.md #1.

5. **Shell resize corrupts input** - WebSocket resize messages corrupt PTY input buffer. Partial client-side filter doesn't fix root cause. See BACKEND_TODOS.md #22.

**When backend is fixed**: Run `pnpm generate-api`, remove corresponding transform, update BACKEND_TODOS.md.

### Production vs Development Behavior

| Feature | Development | Production |
|---------|-------------|------------|
| **Backend routing** | `next.config.ts` proxy to configured hostname | Same (runtime config) |
| **Login screen** | Shows cookie paste UI (`LocalDevLogin`) | SSO button only (Envoy handles auth) |
| **Auth client secret** | Uses `.env.local` | Uses environment variable |
| **Mock mode** | `pnpm dev:mock` for offline dev | N/A (not bundled) |

**Production-first design**: Dev features have zero impact on production builds. Dev components use `next/dynamic` for code splitting.

### Base Path for Deployment

This UI can be deployed at a subpath (e.g., `/v2`) alongside legacy UI:

```bash
NEXT_PUBLIC_BASE_PATH=/v2 pnpm build
```

All routes become `/v2/*`. API rewrites still forward to backend `/api/*` (no prefix).

## Testing Philosophy

### Unit Tests (Vitest)

**Only test high-value, low-brittleness areas:**
- `transforms.ts` - Backend data transformations (catches API changes)
- `utils.ts` - Pure functions (easy to test, unlikely to break)

**Don't test**: UI components, generated code, shadcn/ui primitives.

**Location**: `src/**/*.test.ts`

### E2E Tests (Playwright)

**Focus**: Verify user outcomes, not implementation details.

**Structure**:
```
e2e/
├── fixtures.ts             # Playwright test + withData/withAuth
├── journeys/               # User journey tests
│   ├── auth.spec.ts
│   ├── pools.spec.ts
│   └── resources.spec.ts
└── mocks/                  # Type-safe mock data factories
```

**Key principles**:
- Use semantic selectors (`getByRole`, `getByLabel`)
- Tests run offline (Playwright route mocking)
- Tests should survive virtualization, pagination, filter UI changes
- Co-locate mock data with assertions (not in separate fixtures)

**Example**:
```typescript
import { test, expect, createPoolResponse } from "../fixtures";

test("shows pool list", async ({ page, withData }) => {
  // ARRANGE: Data co-located with test
  await withData({
    pools: createPoolResponse([
      { name: "pool-alpha", status: "ONLINE" },
    ]),
  });

  // ACT
  await page.goto("/pools");

  // ASSERT
  await expect(page.getByRole("heading")).toContainText("pool-alpha");
});
```

## Performance Optimizations

### Build-Time
- `optimizeCss` - Extracts and inlines critical CSS
- `optimizePackageImports` - Tree-shakes lucide-react, Radix UI
- Console stripping - Removes `console.log` in production
- Turbopack - Default bundler (fast builds)

### Runtime
- **Virtualization** - TanStack Virtual for large lists
- **CSS Containment** - `contain: strict` on containers (`.contain-strict` utility)
- **GPU Transforms** - `translate3d()` for positioning (`.gpu-layer` utility)
- **Deferred Values** - `useDeferredValue` for search filters
- **URL State** - `nuqs` for shareable filter URLs
- **React Query** - `staleTime: 60s`, `gcTime: 300s`, structural sharing

### React 19 Features
- `use()` hook for async params/searchParams
- `cacheComponents` (production only - PPR via cache layering)
- Compiler optimizations via React Compiler

**IMPORTANT**: `cacheComponents: false` in development (causes constant re-rendering). Only enabled in production builds.

## SSR/PPR Hydration Safety

**SSR with localStorage causes hydration mismatches.** The server renders with default state, but the client has different values in localStorage. React sees different HTML → hydration error.

### Zustand Stores with Persistence

```tsx
// ❌ FORBIDDEN: Direct store access for persisted values in SSR components
const displayMode = useSharedPreferences((s) => s.displayMode);

// ✅ REQUIRED: Use hydration-safe selectors from @/stores
import { useDisplayMode, useCompactMode, useSidebarOpen } from "@/stores";
const displayMode = useDisplayMode();
```

| Selector | SSR Value | After Hydration |
|----------|-----------|-----------------|
| `useDisplayMode()` | `"free"` | localStorage value |
| `useCompactMode()` | `false` | localStorage value |
| `useSidebarOpen()` | `true` | localStorage value |
| `useDetailsExpanded()` | `false` | localStorage value |
| `useDetailsPanelCollapsed()` | `false` | localStorage value |
| `usePanelWidthPct()` | `50` | localStorage value |

### Date/Time Formatting

```tsx
// ❌ FORBIDDEN: Locale-dependent formatting during SSR
date.toLocaleString();
new Date().toDateString() === date.toDateString(); // "is today" check

// ✅ REQUIRED: SSR-safe formatters from @/lib/format-date
import { formatDateTimeFull, formatDateTimeSuccinct } from "@/lib/format-date";
formatDateTimeFull(date);      // "Jan 15, 2026, 2:30:45 PM"
formatDateTimeSuccinct(date);  // "1/15/26 2:30p"
```

For relative time ("today"), use after hydration check:

```tsx
import { useIsHydrated } from "@/hooks";
import { formatDateTimeRelative, formatDateTimeFull } from "@/lib/format-date";

const isHydrated = useIsHydrated();
const time = isHydrated ? formatDateTimeRelative(date) : formatDateTimeFull(date);
```

### Client-Only UI (Radix dropdowns, DnD)

```tsx
// ❌ FORBIDDEN: Radix components without hydration guard (generates different IDs)
return <DropdownMenu>...</DropdownMenu>;

// ✅ REQUIRED: Guard with useMounted
import { useMounted } from "@/hooks";

const mounted = useMounted();
if (!mounted) return <Button disabled>...</Button>;
return <DropdownMenu>...</DropdownMenu>;
```

### Creating Hydration-Safe Selectors for Custom Stores

```tsx
import { createHydratedSelector } from "@/hooks";
import { useMyStore, initialState } from "./my-store";

export const useMyValue = createHydratedSelector(
  useMyStore,
  (s) => s.myValue,
  initialState.myValue,
);
```

### Performance Requirements

| Scenario | MUST Use | Reason |
|----------|----------|--------|
| Lists > 50 items | TanStack Virtual + `contain-strict` | Prevent DOM bloat |
| Search inputs | `useDeferredValue` | Don't block typing |
| Heavy state updates | `startTransition` | Keep UI responsive |
| Scroll containers | `overscroll-behavior: contain` | Prevent scroll chaining |

**Animation rules:**
- ✅ Animate: `transform`, `opacity` (GPU-accelerated)
- ❌ NEVER animate: `width`, `height`, `margin`, `padding` (causes reflow)

### Loop Optimization

```typescript
// ❌ SLOW
const edges = groups.flatMap((g) => g.edges.map(...));

// ✅ FAST
const edges: Edge[] = [];
for (const g of groups) {
  for (const e of g.edges) edges.push(e);
}
```

### Concurrent Features

```typescript
import { startTransition } from "react";
startTransition(() => {
  setNodes(result.nodes);
});
```

### Data Attribute Handlers

```typescript
const handleClick = useCallback((e) => {
  const idx = Number(e.currentTarget.dataset.index);
}, [items]);

<button data-index={i} onClick={handleClick} />
```

## React 19: useEffectEvent Usage

⚠️ **CRITICAL WARNING (React 19.2.x):** `useEffectEvent` may cause infinite `reconnectPassiveEffects`
loops in Next.js 16 + TanStack Query environments. If you encounter infinite rendering or console
spam, immediately revert to primitive unpacking with `useMemo` instead (see "Returning new objects"
in Forbidden Patterns section).

`useEffectEvent` is used to extract **non-reactive** logic from Effects. It allows an Effect to read the latest props/state without re-running when those values change.

### ✅ When to use
- **Effect Synchronization**: When logic inside a `useEffect` needs to access the latest state/props but shouldn't trigger the effect to re-run.
- **Event Listeners**: Inside an effect that attaches a DOM/Window listener (e.g., `keydown`, `resize`) to ensure the handler always sees fresh state.
- **Bridging External Systems**: Bridging React state to non-React systems (WebSockets, Maps API, etc.) inside an effect.

### ❌ When NOT to use
- **UI Event Handlers**: Never use for `onClick`, `onChange`, or other handlers passed to JSX. Use `useCallback` or standard functions instead.
- **Prop Drilling**: Never pass a function returned by `useEffectEvent` as a prop to other components.
- **During Render**: Never call an Effect Event during the render phase (e.g., inside `useMemo` or the component body).
- **Dependency Arrays**: Never include an Effect Event in a dependency array (it is a stable reference by design).

### 💡 The "Reactive vs. Non-Reactive" Rule
- If the logic should **trigger** an update when values change → Use `useEffect` with dependencies.
- If the logic should **react** to an event but only **read** the latest values → Use `useEffectEvent`.

## Accessibility Requirements

All interactive elements MUST be keyboard accessible:

- **Enter/Space**: Activate buttons and controls
- **Arrow keys**: Navigate within composite widgets
- **Escape**: Close modals, cancel operations
- **Tab**: Move between focusable elements

```tsx
// ✅ REQUIRED: Screen reader announcements for dynamic changes
const { announcer } = useServices();
await clipboard.copy(text);
announcer.announce("Copied to clipboard", "polite");
```

```tsx
// ✅ REQUIRED: Focus visible styling
<Button className="focus-nvidia">...</Button>
```

## Single Source of Truth

NEVER hardcode these values. ALWAYS use the designated source:

| What | Source | NOT |
|------|--------|-----|
| Row heights, spacing | `useConfig()` → `table.rowHeights` | Magic numbers like `48` |
| Panel widths | `useConfig()` → `panel.*` | Hardcoded `320px` |
| API types | `@/lib/api/adapter/` | `@/lib/api/generated.ts` |
| Enums ONLY | `@/lib/api/generated.ts` | String literals |
| Status enums | `WorkflowStatus`, `TaskGroupStatus`, `PoolStatus` | `"RUNNING"`, `"ONLINE"` |
| Priority enum | `WorkflowPriority` | `"HIGH"`, `"NORMAL"`, `"LOW"` |
| CSS variables | `globals.css` | Inline hex colors |
| Feature constants | `feature/lib/constants.ts` | Scattered magic strings |
| Column configs | `feature/lib/feature-columns.ts` | Inline column definitions |
| Clipboard operations | `useServices().clipboard` | `navigator.clipboard` directly |
| Screen reader announcements | `useServices().announcer` | Manual aria-live regions |
| URL state | `usePanelState()`, `useUrlChips()` | Raw `useSearchParams` |

## Code Style Notes

### ESLint Rules
- Unused vars starting with `_` are allowed
- React Compiler checks enabled
- Production code cannot import from `/experimental`
- Feature modules should use public API imports (warnings)

### File Naming
- `kebab-case` for files
- `PascalCase` for components
- `camelCase` for utilities

### Import Order
```typescript
// 1. External packages
import { useState } from 'react';

// 2. Absolute imports (@/...)
import { usePools } from '@/lib/api/adapter';

// 3. Relative imports
import { PoolCard } from './pool-card';
```

### Copyright Headers

**ALL new files MUST include the NVIDIA copyright header at the top.**

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

**When to include:**
- ✅ REQUIRED: All new `.ts`, `.tsx`, `.js`, `.jsx` files
- ✅ REQUIRED: All new component files, hooks, utilities, tests
- ❌ SKIP: Config files (e.g., `next.config.ts`, `tailwind.config.ts`)
- ❌ SKIP: Package files (`package.json`, `tsconfig.json`)
- ❌ SKIP: Generated files (e.g., `src/lib/api/generated.ts`)

## Hermetic Development (Mock Mode)

Run UI **without any backend** using deterministic synthetic data:

```bash
pnpm dev:mock
```

**How it works**:
- MSW intercepts all API requests in the browser
- Generators produce data on-demand using `faker.seed(baseSeed + index)`
- Same index = same data (deterministic)
- Configurable via browser console: `__mockConfig.setWorkflowTotal(100000)`

**Default volumes**: 10k workflows, 50 pools, 500 resources, 100 datasets

**Supported endpoints**: All API endpoints with infinite pagination

**Use cases**:
- Offline development
- UI testing with large datasets
- Stress testing virtualization/pagination
- Demo mode

**Location**: `src/mocks/`

## Important Files to Know

| File | Purpose |
|------|---------|
| `src/lib/api/adapter/BACKEND_TODOS.md` | **READ THIS FIRST** - 22 backend issues and workarounds |
| `src/lib/api/adapter/README.md` | Adapter layer philosophy |
| `src/lib/api/generated.ts` | Auto-generated API client (NEVER EDIT) |
| `src/lib/auth/README.md` | Authentication setup |
| `src/lib/query-client.ts` | React Query configuration |
| `src/lib/config.ts` | Runtime configuration (base path, API hostname) |
| `next.config.ts` | Next.js configuration (proxy, optimization) |
| `orval.config.ts` | API codegen configuration |

## Troubleshooting

| Issue | Fix |
|-------|-----|
| Types out of sync | `pnpm generate-api && pnpm type-check` |
| Backend returns wrong data | Check `src/lib/api/adapter/BACKEND_TODOS.md` for known issues |
| Auth not working | Check `.env.local` has `AUTH_CLIENT_SECRET` and `NEXT_PUBLIC_OSMO_API_HOSTNAME` |
| Tests failing | Run `pnpm test:e2e:ui` for interactive debugging |
| Mock data not showing | Check browser console for MSW worker status |

## Tech Stack Reference

| Layer | Tool |
|-------|------|
| Framework | Next.js 16 (App Router, Turbopack, PPR) |
| UI | React 19, Tailwind CSS 4, shadcn/ui |
| State | TanStack Query 5, Zustand (minimal) |
| Virtualization | TanStack Virtual |
| Forms | React Hook Form + Zod |
| API Codegen | orval (from OpenAPI) |
| Testing | Vitest (unit), Playwright (E2E) |
| Mocking | MSW (dev mode), Playwright route mocking (E2E) |

## Final Verification Checklist

Before submitting any code, verify:

- [ ] Did I run `pnpm type-check && pnpm lint && pnpm test --run` with ZERO errors/warnings?
- [ ] Did I check `@/components/` before creating a new component?
- [ ] Are ALL imports from public APIs (`index.ts` exports)?
- [ ] Are types from `@/lib/api/adapter`, enums from `@/lib/api/generated`?
- [ ] Am I using enum values (e.g., `PoolStatus.ONLINE`) instead of string literals (`"ONLINE"`)?
- [ ] Is every interactive element keyboard accessible?
- [ ] Did I use TanStack/Zustand/nuqs instead of manual state?
- [ ] Are there any magic numbers that should be constants or config values?
- [ ] Do all NEW files have the NVIDIA copyright header?
- [ ] Did I run `pnpm format` after all checks passed?

**If any answer is NO, fix it before proceeding.**

## Next Steps After Reading This

1. Read `src/lib/api/adapter/BACKEND_TODOS.md` to understand backend limitations
2. Run `pnpm dev` to start local development
3. Try `pnpm dev:mock` to see hermetic development mode
4. Run `pnpm test:e2e:ui` to explore E2E tests interactively
5. Check `src/app/(dashboard)/pools/` as a reference feature module
