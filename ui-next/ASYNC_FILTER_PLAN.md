# Async Filter Suggestions Implementation Plan

## Overview

Add async loading support to FilterBar component for workflow user and pool filter suggestions. This enables lazy, cacheable fetching of exhaustive suggestion lists with good loading UX.

## Requirements

1. **Lazy loading**: Only fetch when user types in the filter field (don't fetch on page load)
2. **Cacheable**: Cache for 5 minutes to avoid repeated fetches (TanStack Query)
3. **Loading UX**: Show loading indicator in suggestion dropdown while fetching
4. **Backwards compatible**: Existing sync fields continue to work unchanged
5. **Type-safe**: Maintain strong typing throughout

## Architecture Decision

Based on exploration, we'll use:
- **User suggestions**: Aggregate from workflow list API (no dedicated endpoint exists)
- **Pool suggestions**: Use pools API (`getPoolQuotasApiPoolQuotaGet`) - fastest option
- **Generic design**: SearchField supports both sync and async via new `isAsync` flag
- **Component-level state**: FilterBar manages async providers passed from parent

## Implementation Phases

### Phase 1: Backend Integration Layer

**File: `src/lib/api/adapter/workflows-shim.ts`**

Add aggregation function for user suggestions:

```typescript
/**
 * Fetch all unique users who have submitted workflows.
 *
 * WORKAROUND: Backend doesn't provide dedicated /api/users endpoint.
 * This fetches workflows and extracts unique users.
 * See: BACKEND_TODOS.md #23 (to be added)
 */
export async function fetchAllWorkflowUsers(): Promise<string[]> {
  const rawData = await listWorkflowApiWorkflowGet({
    offset: 0,
    limit: 10000, // Large limit to get exhaustive list
    all_users: true,
    all_pools: true,
    order: 'DESC',
  });

  const parsed = parseWorkflowsResponse(rawData);
  if (!parsed) return [];

  // Extract unique users, sorted alphabetically
  const users = [...new Set(parsed.workflows.map(w => w.user))]
    .filter(Boolean)
    .sort((a, b) => naturalCompare(a, b));

  return users;
}
```

**File: `src/lib/api/adapter/pools-shim.ts`** (or existing pools file)

Add function to extract pool names from pools API:

```typescript
/**
 * Fetch all pool names for filter suggestions.
 * Uses existing pools API which is optimized for this.
 */
export async function fetchAllPoolNames(): Promise<string[]> {
  const rawData = await getPoolQuotasApiPoolQuotaGet({
    all_pools: true,
  });

  const parsed = parsePoolQuotasResponse(rawData);
  if (!parsed) return [];

  // Extract pool names, sorted alphabetically
  const poolNames = parsed
    .map(p => p.name)
    .filter(Boolean)
    .sort((a, b) => naturalCompare(a, b));

  return poolNames;
}
```

**File: `src/lib/api/adapter/hooks.ts`**

Add React Query hooks with lazy loading:

```typescript
/**
 * Hook to fetch all workflow users for filter suggestions.
 *
 * Lazy loading strategy:
 * - Start with enabled: false
 * - Call refetch() when user opens user filter
 * - Long stale time (5 minutes) - users change infrequently
 */
export function useWorkflowUsers(enabled: boolean = false) {
  const query = useQuery({
    queryKey: ["workflows", "users"] as const,
    queryFn: fetchAllWorkflowUsers,
    staleTime: QUERY_STALE_TIME_EXPENSIVE_MS, // 5 minutes
    enabled,
  });

  return {
    users: query.data ?? [],
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    error: query.error,
    refetch: query.refetch,
  };
}

/**
 * Hook to fetch all pool names for filter suggestions.
 *
 * Uses pools API (faster than workflow aggregation).
 * Same lazy loading strategy as useWorkflowUsers.
 */
export function usePoolNames(enabled: boolean = false) {
  const query = useQuery({
    queryKey: ["pools", "names"] as const,
    queryFn: fetchAllPoolNames,
    staleTime: QUERY_STALE_TIME_EXPENSIVE_MS, // 5 minutes
    enabled,
  });

  return {
    pools: query.data ?? [],
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    error: query.error,
    refetch: query.refetch,
  };
}
```

**File: `src/lib/api/adapter/index.ts`**

Export new hooks and functions:

```typescript
export { useWorkflowUsers, usePoolNames } from "./hooks";
export { fetchAllWorkflowUsers } from "./workflows-shim";
export { fetchAllPoolNames } from "./pools-shim"; // or wherever it's added
```

**File: `src/lib/api/adapter/BACKEND_TODOS.md`**

Add new issue documenting the workaround:

```markdown
### 23. Missing User/Pool Filter Suggestion Endpoints

**Priority:** Medium
**Status:** Active workaround

**Issue:**
Backend doesn't provide dedicated endpoints for filter suggestions:
- No `/api/workflows/users` to get list of all users who submitted workflows
- No `/api/pools/names` to get lightweight pool name list

**Impact:**
- User suggestions require fetching 10k workflows and aggregating
- Less efficient than dedicated endpoint
- Increases load on workflow list API

**Workaround:**
- Users: Fetch workflows with large limit, extract unique users
  - `fetchAllWorkflowUsers()` in `workflows-shim.ts`
- Pools: Use existing pools quota API (fast enough)
  - `fetchAllPoolNames()` in `pools-shim.ts`

**Backend TODO:**
Add lightweight filter suggestion endpoints:
- `GET /api/workflows/users` → `["user1", "user2", ...]`
- `GET /api/pools/names` → `["pool1", "pool2", ...]` (if pools API too heavy)
```

---

### Phase 2: FilterBar Type Extensions

**File: `src/components/filter-bar/lib/types.ts`**

Extend types to support async suggestions:

```typescript
// Extend SearchField interface (around line 35)
export interface SearchField<T> {
  /** Unique identifier for the field */
  id: string;
  /** Display label (e.g., "Status", "Platform") */
  label: string;
  /** Prefix for typed queries (e.g., "status:", "platform:") */
  prefix: string;

  /**
   * Extract autocomplete values from data (sync).
   * Used for fields that derive suggestions from loaded data.
   *
   * OPTIONAL: Can be omitted for async-only fields (when isAsync: true).
   */
  getValues?: (data: T[]) => string[];

  /**
   * Whether this field uses async suggestions.
   * When true, FilterBar expects an async provider in asyncProviders prop.
   * When false/undefined, uses sync getValues().
   */
  isAsync?: boolean;

  // ... rest of existing fields ...
}

// Extend Suggestion type (around line 206)
export interface Suggestion<T> {
  /** Type of suggestion */
  type: "field" | "value" | "hint" | "loading"; // Add "loading" type
  /** The field this suggestion is for */
  field: SearchField<T>;
  /** The value to use when selected */
  value: string;
  /** Display label */
  label: string;
  /** Optional hint text */
  hint?: string;
  /** Loading indicator for async fields */
  isLoading?: boolean;
}

// Add new type for async providers
/**
 * Async value provider for a field.
 * Returned by hooks like useWorkflowUsers(), usePoolNames().
 */
export interface AsyncProvider {
  /** Available values (empty array while loading) */
  values: string[];
  /** Initial loading state (never fetched) */
  isLoading: boolean;
  /** Refetching state (updating cache) */
  isFetching: boolean;
  /** Trigger fetch (for lazy loading) */
  refetch: () => void;
}

// Extend FilterBarProps (around line 173)
export interface FilterBarProps<T> {
  // ... existing props ...

  /**
   * Async value providers for fields with isAsync: true.
   * Map of field.id -> async provider hook result.
   *
   * Example:
   * ```typescript
   * const usersQuery = useWorkflowUsers(false);
   * const asyncProviders = new Map([
   *   ["user", {
   *     values: usersQuery.users,
   *     isLoading: usersQuery.isLoading,
   *     isFetching: usersQuery.isFetching,
   *     refetch: usersQuery.refetch,
   *   }],
   * ]);
   * ```
   */
  asyncProviders?: Map<string, AsyncProvider>;
}
```

---

### Phase 3: Async Suggestions Hook

**File: `src/components/filter-bar/hooks/use-async-suggestions.ts` (NEW)**

Create dedicated hook for async suggestion management:

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

/**
 * Hook for managing async field suggestions.
 *
 * Responsibilities:
 * - Track which async fields are active (user is typing in them)
 * - Trigger lazy loading when field becomes active
 * - Merge async results with sync suggestions
 * - Handle loading/error states
 */

import { useMemo, useEffect, useState } from "react";
import type { SearchField, AsyncProvider, ParsedInput } from "../lib";

export interface UseAsyncSuggestionsOptions<T> {
  /** Current parsed input (from useSuggestions) */
  parsedInput: ParsedInput<T>;
  /** All field definitions */
  fields: readonly SearchField<T>[];
  /** Async value providers (field.id -> fetcher hook) */
  asyncProviders: Map<string, AsyncProvider>;
}

export interface UseAsyncSuggestionsReturn {
  /** Async values by field ID */
  asyncValues: Map<string, string[]>;
  /** Loading state by field ID */
  loadingFields: Set<string>;
  /** Trigger async fetch for a field */
  triggerFetch: (fieldId: string) => void;
}

export function useAsyncSuggestions<T>({
  parsedInput,
  asyncProviders,
}: UseAsyncSuggestionsOptions<T>): UseAsyncSuggestionsReturn {
  // Track which fields have been fetched (to trigger lazy loading once)
  const [fetchedFields, setFetchedFields] = useState<Set<string>>(new Set());

  // Auto-trigger fetch when user types in an async field
  useEffect(() => {
    if (parsedInput.hasPrefix && parsedInput.field?.isAsync) {
      const fieldId = parsedInput.field.id;
      if (!fetchedFields.has(fieldId)) {
        const provider = asyncProviders.get(fieldId);
        if (provider && !provider.isLoading) {
          provider.refetch();
          setFetchedFields(prev => new Set([...prev, fieldId]));
        }
      }
    }
  }, [parsedInput, asyncProviders, fetchedFields]);

  // Build async values map (memoized for reference stability)
  const asyncValues = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const [fieldId, provider] of asyncProviders) {
      if (provider.values.length > 0) {
        map.set(fieldId, provider.values);
      }
    }
    return map;
  }, [asyncProviders]);

  // Build loading fields set (memoized for reference stability)
  const loadingFields = useMemo(() => {
    const set = new Set<string>();
    for (const [fieldId, provider] of asyncProviders) {
      if (provider.isLoading || provider.isFetching) {
        set.add(fieldId);
      }
    }
    return set;
  }, [asyncProviders]);

  return {
    asyncValues,
    loadingFields,
    triggerFetch: () => {}, // Not needed with auto-trigger, but kept for future use
  };
}
```

**File: `src/components/filter-bar/hooks/use-suggestions.ts`**

Modify to integrate async values (changes around line 103-110, 136):

```typescript
export interface UseSuggestionsOptions<T> {
  /** Current input value */
  inputValue: string;
  /** Field definitions */
  fields: readonly SearchField<T>[];
  /** Data for generating autocomplete values */
  data: T[];
  /** Current chips (to filter out already-selected values) */
  chips: SearchChip[];
  /** Preset groups (for flattening for navigation) */
  presets?: {
    label: string;
    items: SearchPreset[];
  }[];
  /** Async values by field ID (from useAsyncSuggestions) */
  asyncValues?: Map<string, string[]>;
  /** Loading fields (from useAsyncSuggestions) */
  loadingFields?: Set<string>;
}

// Modify generateSuggestions function signature (line 103):
function generateSuggestions<T>(
  inputValue: string,
  parsedInput: ParsedInput<T>,
  fields: readonly SearchField<T>[],
  data: T[],
  chips: SearchChip[],
  asyncValues?: Map<string, string[]>, // NEW
  loadingFields?: Set<string>, // NEW
): Suggestion<T>[] {
  // ... existing logic until line 129 ...

  if (parsedInput.hasPrefix && parsedInput.field) {
    // Show values for the selected field
    const field = parsedInput.field;
    const currentPrefix = field.prefix;
    const prefixQuery = parsedInput.query.toLowerCase();

    // NEW: Check if field is loading
    if (loadingFields?.has(field.id)) {
      return [{
        type: "loading",
        field,
        value: "",
        label: "Loading suggestions...",
        isLoading: true,
      }];
    }

    // NEW: Get values from async provider if available, else sync getValues
    let values: string[] = [];
    if (field.isAsync && asyncValues?.has(field.id)) {
      values = asyncValues.get(field.id)!;
    } else if (field.getValues) {
      values = field.getValues(data);
    }

    // ... rest of existing logic (sub-fields, filtering, limiting) ...
  }

  // ... rest unchanged ...
}

// Update hook to pass async params (line 243):
export function useSuggestions<T>({
  inputValue,
  fields,
  data,
  chips,
  presets,
  asyncValues, // NEW
  loadingFields, // NEW
}: UseSuggestionsOptions<T>): UseSuggestionsReturn<T> {
  // ... existing parsedInput logic ...

  // Generate suggestions (now with async support)
  const suggestions = useMemo(
    () => generateSuggestions(inputValue, parsedInput, fields, data, chips, asyncValues, loadingFields),
    [inputValue, parsedInput, fields, data, chips, asyncValues, loadingFields],
  );

  // ... rest unchanged ...
}
```

**File: `src/components/filter-bar/hooks/index.ts`**

Export new hook:

```typescript
export { useChips } from "./use-chips";
export { useSuggestions } from "./use-suggestions";
export { useAsyncSuggestions } from "./use-async-suggestions"; // NEW

export type { UseChipsOptions, UseChipsReturn } from "./use-chips";
export type { UseSuggestionsOptions, UseSuggestionsReturn } from "./use-suggestions";
export type { UseAsyncSuggestionsOptions, UseAsyncSuggestionsReturn } from "./use-async-suggestions"; // NEW
```

**File: `src/components/filter-bar/index.ts`**

Export AsyncProvider type:

```typescript
export { FilterBar } from "./filter-bar";
export type {
  SearchField,
  SearchChip,
  SearchPreset,
  FilterBarProps,
  ResultsCount,
  AsyncProvider, // NEW
} from "./lib/types";
```

---

### Phase 4: FilterBar Component Integration

**File: `src/components/filter-bar/filter-bar.tsx`**

Integrate async support (changes around line 50-80):

```typescript
import { useAsyncSuggestions } from "./hooks";
import type { AsyncProvider } from "./lib/types"; // Add to imports
import { Loader2 } from "lucide-react"; // Add for loading icon

function FilterBarInner<T>({
  data,
  fields,
  chips,
  onChipsChange,
  placeholder = "Search...",
  className,
  displayMode,
  presets,
  resultsCount,
  asyncProviders, // NEW prop
}: FilterBarProps<T>) {
  // ... existing state and hooks ...

  // NEW: Async suggestions support
  const { asyncValues, loadingFields } = useAsyncSuggestions({
    parsedInput, // Will be available after useSuggestions is called
    fields,
    asyncProviders: asyncProviders ?? new Map(),
  });

  // Pass async data to suggestions hook
  const { parsedInput, suggestions, selectableSuggestions, flatPresets } = useSuggestions({
    inputValue,
    fields,
    data,
    chips,
    presets,
    asyncValues, // NEW
    loadingFields, // NEW
  });

  // ... rest of existing logic ...

  // In the dropdown rendering section (around line 200+), add loading type handling:
  {selectableSuggestions.map((suggestion, index) => {
    // NEW: Handle loading type
    if (suggestion.type === "loading") {
      return (
        <CommandItem
          key={`loading-${suggestion.field.id}`}
          disabled
          className="flex items-center gap-2 italic text-muted-foreground"
        >
          <Loader2 className="size-3 animate-spin" />
          <span>{suggestion.label}</span>
        </CommandItem>
      );
    }

    // Existing rendering for other types...
  })}
}
```

---

### Phase 5: Workflow Search Fields Update

**File: `src/app/(dashboard)/workflows/lib/workflow-search-fields.ts`**

Update user and pool fields to use async (changes around line 30-60):

```typescript
export const WORKFLOW_SEARCH_FIELDS: readonly SearchField<WorkflowListEntry>[] = Object.freeze([
  // ... name, status fields unchanged ...

  // USER FIELD - NOW ASYNC
  {
    id: "user",
    label: "User",
    hint: "submitted by",
    prefix: "user:",
    freeFormHint: "Type any username, press Enter",
    isAsync: true, // NEW: Mark as async
    // REMOVED: getValues - now provided by async provider
    exhaustive: false, // Still show hint since we may not have all users
  },

  // POOL FIELD - NOW ASYNC
  {
    id: "pool",
    label: "Pool",
    hint: "pool name",
    prefix: "pool:",
    freeFormHint: "Type any pool, press Enter",
    isAsync: true, // NEW: Mark as async
    // REMOVED: getValues - now provided by async provider
    exhaustive: false,
  },

  // ... priority, app, tag fields unchanged ...
]);
```

---

### Phase 6: Workflows Page Integration

**File: `src/app/(dashboard)/workflows/workflows-page-content.tsx`**

Wire up async providers (add around line 20-40):

```typescript
"use client";

import { useMemo } from "react";
import { useWorkflowUsers, usePoolNames } from "@/lib/api/adapter";
import type { AsyncProvider } from "@/components/filter-bar";

export default function WorkflowsPageContent({
  // ... existing props
}) {
  // ... existing hooks ...

  // NEW: Lazy-load async suggestions (enabled: false for lazy loading)
  const usersQuery = useWorkflowUsers(false);
  const poolsQuery = usePoolNames(false);

  // NEW: Build async providers map (memoized for reference stability)
  const asyncProviders = useMemo(() => {
    const map = new Map<string, AsyncProvider>();

    map.set("user", {
      values: usersQuery.users,
      isLoading: usersQuery.isLoading,
      isFetching: usersQuery.isFetching,
      refetch: usersQuery.refetch,
    });

    map.set("pool", {
      values: poolsQuery.pools,
      isLoading: poolsQuery.isLoading,
      isFetching: poolsQuery.isFetching,
      refetch: poolsQuery.refetch,
    });

    return map;
  }, [usersQuery, poolsQuery]);

  return (
    <div className="flex h-full flex-col">
      <WorkflowsToolbar
        workflows={workflows}
        searchChips={searchChips}
        onSearchChipsChange={setSearchChips}
        asyncProviders={asyncProviders} // NEW: Pass to toolbar
        // ... other props ...
      />
      {/* ... rest unchanged ... */}
    </div>
  );
}
```

**File: `src/app/(dashboard)/workflows/components/workflows-toolbar.tsx`**

Pass through async providers to TableToolbar:

```typescript
import type { AsyncProvider } from "@/components/filter-bar";

export interface WorkflowsToolbarProps {
  workflows: WorkflowListEntry[];
  searchChips: SearchChip[];
  onSearchChipsChange: (chips: SearchChip[]) => void;
  asyncProviders?: Map<string, AsyncProvider>; // NEW
  // ... other props ...
}

export const WorkflowsToolbar = memo(function WorkflowsToolbar({
  workflows,
  searchChips,
  onSearchChipsChange,
  asyncProviders, // NEW
  // ... other props ...
}: WorkflowsToolbarProps) {
  return (
    <div className="flex flex-col gap-2 p-4">
      {/* Status presets, user toggle... */}

      <TableToolbar
        data={workflows}
        searchFields={WORKFLOW_SEARCH_FIELDS}
        searchChips={searchChips}
        onSearchChipsChange={onSearchChipsChange}
        asyncProviders={asyncProviders} // NEW: Pass through
        // ... other props ...
      />
    </div>
  );
});
```

**File: `src/components/data-table/table-toolbar.tsx`**

Update TableToolbar to accept and pass async providers:

```typescript
import type { AsyncProvider } from "@/components/filter-bar";

interface TableToolbarProps<T> {
  data: T[];
  searchFields?: readonly SearchField<T>[];
  searchChips?: SearchChip[];
  onSearchChipsChange?: (chips: SearchChip[]) => void;
  asyncProviders?: Map<string, AsyncProvider>; // NEW
  // ... other props ...
}

export function TableToolbar<T>({
  data,
  searchFields,
  searchChips,
  onSearchChipsChange,
  asyncProviders, // NEW
  // ... other props ...
}: TableToolbarProps<T>) {
  // ... existing logic ...

  return (
    <div className="flex items-center gap-2">
      {searchFields && searchChips && onSearchChipsChange && (
        <FilterBar
          data={data}
          fields={searchFields}
          chips={searchChips}
          onChipsChange={onSearchChipsChange}
          asyncProviders={asyncProviders} // NEW: Pass to FilterBar
          // ... other props ...
        />
      )}
      {/* ... other toolbar items ... */}
    </div>
  );
}
```

---

## Testing Strategy

### Unit Tests

**File: `src/lib/api/adapter/workflows-shim.test.ts`** (add tests)

```typescript
describe("fetchAllWorkflowUsers", () => {
  it("extracts unique users from workflows", async () => {
    // Mock listWorkflowApiWorkflowGet
    const users = await fetchAllWorkflowUsers();
    expect(users).toEqual(["alice", "bob", "charlie"]); // sorted
  });

  it("filters out null users", async () => {
    // Test with null user field
  });

  it("returns empty array on API error", async () => {
    // Test error handling
  });
});

describe("fetchAllPoolNames", () => {
  it("extracts pool names from pools API", async () => {
    const pools = await fetchAllPoolNames();
    expect(pools).toEqual(["pool-a", "pool-b", "pool-c"]); // sorted
  });
});
```

**File: `src/components/filter-bar/hooks/use-async-suggestions.test.ts`** (NEW)

```typescript
describe("useAsyncSuggestions", () => {
  it("triggers lazy fetch when field becomes active", () => {
    // Test refetch() called on first prefix match
  });

  it("does not trigger fetch if already fetched", () => {
    // Test fetchedFields tracking
  });

  it("builds asyncValues map from providers", () => {
    // Test memoization
  });

  it("builds loadingFields set from providers", () => {
    // Test loading state tracking
  });
});
```

**File: `src/components/filter-bar/filter-bar.test.tsx`** (extend existing)

```typescript
describe("FilterBar async support", () => {
  it("shows loading indicator for async field", () => {
    // Render with loadingFields containing field.id
    // Verify loading suggestion appears
  });

  it("shows async values when loaded", () => {
    // Render with asyncValues containing field data
    // Verify suggestions appear
  });

  it("falls back to sync getValues for non-async fields", () => {
    // Mix of async and sync fields
    // Verify both work
  });

  it("allows free text while loading", () => {
    // Type and press Enter while loading
    // Verify chip created with typed value
  });
});
```

### E2E Tests

**File: `e2e/journeys/workflows-filters.spec.ts`** (extend existing)

```typescript
test("async user filter suggestions", async ({ page, withData }) => {
  await withData({
    workflows: createWorkflowResponse([
      { name: "wf-1", user: "alice" },
      { name: "wf-2", user: "bob" },
    ]),
  });

  await page.goto("/workflows");

  // Type user prefix
  const filterInput = page.getByPlaceholder("Search...");
  await filterInput.fill("user:");

  // Should show loading indicator initially
  await expect(page.getByText("Loading suggestions...")).toBeVisible();

  // Wait for suggestions to load
  await expect(page.getByText("user:alice")).toBeVisible();
  await expect(page.getByText("user:bob")).toBeVisible();

  // Select a user
  await page.getByText("user:alice").click();

  // Verify chip created
  await expect(page.getByRole("button", { name: /User: alice/ })).toBeVisible();

  // Type user prefix again (should use cache, no loading)
  await filterInput.fill("user:");

  // Should NOT show loading (using cache)
  await expect(page.getByText("Loading suggestions...")).not.toBeVisible();

  // Suggestions should appear immediately
  await expect(page.getByText("user:bob")).toBeVisible();
});

test("async pool filter suggestions", async ({ page, withData }) => {
  // Similar test for pool field
});
```

---

## Performance Considerations

### Lazy Loading
- Queries start with `enabled: false` to prevent page load fetching
- Only fetch when user types field prefix
- `useEffect` triggers `refetch()` on first interaction
- `fetchedFields` Set prevents duplicate fetches

### Caching
- 5-minute stale time (`QUERY_STALE_TIME_EXPENSIVE_MS`)
- Cache shared across all FilterBar instances (same query key)
- Users/pools change infrequently, long cache is safe
- Manual invalidation on workflow mutations (future enhancement)

### Request Deduplication
- TanStack Query automatically deduplicates concurrent requests
- Multiple FilterBars fetching same data share single request
- Query keys are deterministic and stable

### Reference Stability
- `asyncProviders` Map memoized at page level
- `asyncValues` and `loadingFields` memoized in hook
- Prevents cascading re-renders from new object references
- Follows CLAUDE.md pattern for returned objects

### Progressive Enhancement
- Sync fields work immediately (no degradation)
- Async fields show loading but don't block interaction
- Free text entry works even while loading
- No layout shift (loading indicator replaces empty state)

---

## Backwards Compatibility

### Existing Fields (No Changes Required)
- Status, priority, app, tag fields unchanged
- Continue using sync `getValues(data)`
- No performance impact
- No prop changes needed

### New Async Fields
- Opt-in via `isAsync: true` flag
- Requires `asyncProviders` prop on FilterBar
- Graceful degradation: empty array if provider missing
- Free text still works without provider

### Migration Path
```typescript
// OLD (still works):
{
  id: "user",
  getValues: (workflows) => [...new Set(workflows.map(w => w.user))],
}

// NEW (async):
{
  id: "user",
  isAsync: true,
  // getValues removed
}
```

---

## Future Enhancements

1. **Backend Endpoints**: When backend adds `/api/workflows/users` and `/api/pools/names`, update fetch functions to use dedicated endpoints
2. **Cache Invalidation**: Invalidate user/pool cache on workflow mutations (submission, deletion)
3. **Prefetching**: Prefetch on page hover using router `prefetchQuery`
4. **Virtualization**: For very large lists (>1000 items), add TanStack Virtual to dropdown
5. **Server-Side Search**: Add `searchAsync` to SearchField for server-side filtering within suggestions

---

## Critical Files

| File | Purpose |
|------|---------|
| `src/components/filter-bar/lib/types.ts` | Extend SearchField, Suggestion, add AsyncProvider type |
| `src/components/filter-bar/hooks/use-suggestions.ts` | Integrate async values into suggestion generation |
| `src/components/filter-bar/hooks/use-async-suggestions.ts` | New hook for async state management |
| `src/lib/api/adapter/workflows-shim.ts` | Add fetchAllWorkflowUsers aggregation |
| `src/lib/api/adapter/pools-shim.ts` | Add fetchAllPoolNames extraction |
| `src/lib/api/adapter/hooks.ts` | Add useWorkflowUsers, usePoolNames hooks |
| `src/app/(dashboard)/workflows/lib/workflow-search-fields.ts` | Mark user/pool as async |
| `src/app/(dashboard)/workflows/workflows-page-content.tsx` | Wire up async providers |
| `src/components/data-table/table-toolbar.tsx` | Pass through asyncProviders |

---

## Verification Steps

After implementation, verify:

1. **Type-check**: `cd external/ui-next && pnpm type-check` (zero errors)
2. **Lint**: `pnpm lint` (zero errors)
3. **Unit tests**: `pnpm test -- filter-bar` (all pass)
4. **Unit tests**: `pnpm test -- workflows-shim` (all pass)
5. **E2E tests**: `pnpm test:e2e -- workflows-filters` (all pass)
6. **Manual testing**:
   - Navigate to `/workflows`
   - Type `user:` → see loading indicator
   - Wait for suggestions to load
   - Type to filter suggestions
   - Select a user → chip created
   - Type `user:` again → no loading (cached)
   - Repeat for `pool:`
7. **Format**: `pnpm format`
8. **Build**: `pnpm build` (succeeds)

All checks must pass with ZERO errors before considering complete.
