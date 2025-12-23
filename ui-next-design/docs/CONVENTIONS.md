# OSMO UI Conventions Reference

> **For Local LLM Use**: Paste relevant sections into prompts to ensure generated code follows project conventions.

## Styling Conventions

### Tailwind Only (No CSS Modules)

```tsx
// ✅ Good: Tailwind classes
<div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">

// ❌ Bad: CSS modules
import styles from './component.module.css';
<div className={styles.container}>
```

### Use Shared Style Patterns

Import from `@/lib/styles.ts`:

```tsx
import { card, heading, chip, badge, text } from "@/lib/styles";
import { cn } from "@/lib/utils";

// Card container
<div className={cn(card.base, card.hover)}>

// Section heading
<h2 className={heading.section}>Resources</h2>

// Selected chip (NVIDIA green)
<button className={cn(chip.selected, chip.selectedHover)}>

// Badge variants
<span className={badge.success}>Ready</span>
<span className={badge.warning}>Pending</span>
<span className={badge.info}>Shared</span>

// Muted text
<p className={text.muted}>Description here</p>
```

### Dark Mode Pattern

Always include dark mode variants:

```tsx
// Pattern: light-class dark:dark-class
<div className="
  border-zinc-200 bg-white text-zinc-900
  dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100
">
```

### NVIDIA Brand Colors (CSS Variables)

```tsx
// Primary green - use for selected states, CTAs
<button className="bg-[var(--nvidia-green)] text-white">

// Green background tint
<div className="bg-[var(--nvidia-green-bg)] dark:bg-[var(--nvidia-green-bg-dark)]">

// Green text
<span className="text-[var(--nvidia-green)] dark:text-[var(--nvidia-green-light)]">
```

### GPU-Accelerated Animations Only

```tsx
// ✅ Good: GPU-accelerated (transform, opacity)
style={{ transform: `translate3d(0, ${y}px, 0)` }}
className="transition-opacity opacity-0 hover:opacity-100"

// ❌ Bad: Triggers layout/reflow
style={{ top: `${y}px` }}
className="transition-all" // animates everything including layout
```

---

## Component Conventions

### File Naming

```
component-name.tsx       # kebab-case for files
use-hook-name.ts         # hooks prefixed with use-
ComponentName            # PascalCase for component functions
useHookName              # camelCase for hooks
```

### Component Structure

```tsx
// 1. Copyright header
// 2. "use client" directive (if needed)
// 3. Imports (React, then external, then internal)
// 4. Types section
// 5. Constants section
// 6. Main component
// 7. Sub-components (memoized)

"use client";

import { useState, useMemo, memo, useCallback } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { cn } from "@/lib/utils";
import type { Resource } from "@/lib/api/adapter";

// =============================================================================
// Types
// =============================================================================

interface Props {
  resources: Resource[];
  isLoading?: boolean;
}

// =============================================================================
// Constants
// =============================================================================

const ROW_HEIGHT = 48;

// =============================================================================
// Main Component
// =============================================================================

export function ResourceTable({ resources, isLoading = false }: Props) {
  // ... implementation
}

// =============================================================================
// Sub-components
// =============================================================================

const TableRow = memo(function TableRow({ resource }: { resource: Resource }) {
  return <div>{resource.name}</div>;
});
```

### Props Pattern

```tsx
// Explicit props with JSDoc
interface VirtualizedTableProps {
  /** Array of resources to display */
  resources: Resource[];
  /** Total count for "X of Y" display */
  totalCount?: number;
  /** Show loading skeleton */
  isLoading?: boolean;
  /** Show the Pools column (for cross-pool views) */
  showPoolsColumn?: boolean;
  /** Custom click handler */
  onResourceClick?: (resource: Resource) => void;
}
```

---

## TypeScript Conventions

### Import Types Correctly

```tsx
// ✅ Import enums as values (they exist at runtime)
import { PoolStatus, BackendResourceType } from "@/lib/api/generated";

// ✅ Import types with 'type' keyword
import type { Resource, Pool } from "@/lib/api/adapter";
import type { HTTPValidationError } from "@/lib/api/generated";
```

### Use Enums, Not String Literals

```tsx
// ✅ Good: Use generated enum
if (resource.resourceType === BackendResourceType.SHARED) { ... }
if (pool.status === PoolStatus.ONLINE) { ... }

// ❌ Bad: Magic strings
if (resource.resourceType === "SHARED") { ... }
```

### Type Annotations

```tsx
// State with explicit types
const [sort, setSort] = useState<SortState>({ column: null, direction: "asc" });
const [selected, setSelected] = useState<Set<string>>(new Set());

// Callbacks with types
const handleClick = useCallback((id: string) => {
  setSelected(id);
}, []);

// Return types for hooks
export function usePoolDetail(options: Options): UsePoolDetailReturn {
  // ...
}
```

---

## Hook Conventions

### Naming Pattern

```typescript
// Data fetching hooks: useX or useXs
usePools()           // returns { pools, isLoading, error }
usePool(name)        // returns { pool, isLoading, error }
usePoolResources(name)

// Business logic hooks: useXDetail, useXList, useXBehavior
usePoolDetail({ poolName })
usePoolsList({ defaultPoolName })
useAllResources()

// UI behavior hooks: useX
useAutoCollapse(options)
useHorizontalScrollSync(refs)
```

### Return Object Pattern

```typescript
// Always return an object, not a tuple
return {
  // Data
  pool,
  resources: filteredResources,
  
  // State + setters
  search,
  setSearch,
  clearSearch,
  
  // Computed
  hasSearch: search.length > 0,
  filterCount: activeFilters.length,
  
  // Query state
  isLoading,
  error,
  refetch,
};
```

---

## Testing Conventions

### Test File Naming

```
e2e/journeys/
  pools.spec.ts        # Feature journey tests
  resources.spec.ts
  auth.spec.ts

e2e/mocks/
  data.ts              # Default mock data
  factories.ts         # Factory functions
```

### Test Structure (AAA Pattern)

```typescript
test("shows pool resources", async ({ page, withData }) => {
  // ARRANGE - Define scenario data inline
  await withData({
    pools: createPoolResponse([
      { name: "gpu-cluster", status: PoolStatus.ONLINE },
    ]),
    resources: createResourcesResponse([
      { hostname: "node-001.cluster" },
    ]),
  });

  // ACT - Navigate and interact
  await page.goto("/pools/gpu-cluster");
  await page.waitForLoadState("networkidle");

  // ASSERT - Verify expectations
  await expect(page.getByText("node-001")).toBeVisible();
});
```

### Use Generated Enums in Tests

```typescript
import { PoolStatus, BackendResourceType } from "../fixtures";

// ✅ Good: Use enums
createPoolResponse([{ status: PoolStatus.ONLINE }])
createResourceEntry({ resource_type: BackendResourceType.SHARED })

// ❌ Bad: String literals
createPoolResponse([{ status: "ONLINE" }])
```

---

## Accessibility Conventions

### ARIA Labels

```tsx
// Interactive elements need labels
<button aria-label="Close panel">
  <X className="h-4 w-4" />
</button>

// Regions need labels
<div role="region" aria-label="Active filters">

// Tables need proper roles
<div role="table" aria-label="Resources">
  <div role="rowgroup">
    <div role="row">
```

### Focus Management

```tsx
// Use focus-visible for keyboard-only focus rings
className="focus-visible:ring-2 focus-visible:ring-[var(--nvidia-green)]"

// Or the utility class
className="focus-optimized"

// Restore focus when closing dialogs
const lastFocusedRef = useRef<HTMLElement | null>(null);
// ... save ref on open, restore on close
```

### Keyboard Navigation

```tsx
// Table rows should be keyboard navigable
<div
  role="row"
  tabIndex={0}
  onKeyDown={(e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onClick();
    }
  }}
>
```

---

## UI Constants Reference

### Pool Status Display

```typescript
import { getPoolStatusDisplay } from "@/lib/constants/ui";

const status = getPoolStatusDisplay(pool.status);
// Returns: { icon: "🟢", label: "Online", className: "text-emerald-600" }
```

### Resource Type Display

```typescript
import { getResourceAllocationTypeDisplay } from "@/lib/constants/ui";

const display = getResourceAllocationTypeDisplay("SHARED");
// Returns: { label: "Shared", className: "bg-blue-100 text-blue-700 ..." }
```

### Capacity Metrics

```typescript
import { CapacityMetrics } from "@/lib/constants/ui";

CapacityMetrics.GPU   // { key: "gpu", label: "GPU", unit: "", colorClass: "text-purple-500" }
CapacityMetrics.CPU   // { key: "cpu", label: "CPU", unit: "", colorClass: "text-blue-500" }
CapacityMetrics.MEMORY // { key: "memory", label: "Memory", unit: "Gi", ... }
CapacityMetrics.STORAGE // { key: "storage", label: "Storage", unit: "Gi", ... }
```
