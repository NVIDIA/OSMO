# OSMO UI Architecture

This document describes the architectural patterns, dependency injection approach, and code organization principles used in the OSMO UI codebase.

## Overview

The OSMO UI is built with:
- **Next.js 15** with App Router
- **React 19** with React Compiler
- **TanStack Query** for server state
- **Zustand** for client state
- **nuqs** for URL state synchronization
- **TailwindCSS** for styling

## Core Principles

### 1. Dependency Injection via Composition

We use a composition-based approach to dependency injection:

- **Context Providers** for cross-cutting concerns (config, services)
- **Injectable Hook Parameters** for testable logic
- **Feature Module Boundaries** for encapsulation

### 2. Consolidation over Duplication

Common patterns are extracted into reusable utilities:

- Shared hooks in `src/hooks/`
- Shared components in `src/components/`
- Feature-specific code in `src/app/(dashboard)/<feature>/`

### 3. Clear Module Boundaries

Each feature exports a public API through its `index.ts`:

```typescript
// Good: Import from feature's public API
import { usePoolsData, POOL_COLUMN_SIZE_CONFIG } from "@/app/(dashboard)/pools";

// Bad: Deep import into feature internals
import { usePoolsData } from "@/app/(dashboard)/pools/hooks/use-pools-data";
```

---

## Dependency Injection Patterns

### Context-Based DI

For application-wide dependencies, we use React Context:

```
src/contexts/
├── config-context.tsx   # App configuration (row heights, panel sizes, etc.)
├── service-context.tsx  # Cross-cutting services (clipboard, announcer)
└── index.ts            # Barrel export
```

**Usage:**

```tsx
// Access configuration
const { table, panel } = useConfig();
const rowHeight = compactMode ? table.rowHeights.compact : table.rowHeights.normal;

// Access services
const { clipboard, announcer } = useServices();
await clipboard.copy(text);
announcer.announce("Copied to clipboard");
```

**Testing:**

```tsx
<ConfigProvider config={{ table: { rowHeights: { normal: 40 } } }}>
  <ServiceProvider services={{ clipboard: mockClipboard }}>
    <MyComponent />
  </ServiceProvider>
</ConfigProvider>
```

### Hook Options Pattern

For hooks with complex dependencies, we use the options pattern:

```tsx
// In use-dag-state.ts
export function useDAGState({
  groups,
  // Injectable dependencies with defaults
  layoutCalculator = defaultCalculateLayout,
  groupTransformer = defaultTransformGroups,
  cacheManager = { clear: defaultClearLayoutCache },
}: UseDAGStateOptions): UseDAGStateReturn {
  // Use injected dependencies
  const groupsWithLayout = useMemo(() => groupTransformer(groups), [groupTransformer, groups]);
  // ...
}

// In tests
const dagState = useDAGState({
  groups: mockGroups,
  layoutCalculator: vi.fn().mockResolvedValue(mockLayout),
});
```

---

## Directory Structure

```
src/
├── app/
│   └── (dashboard)/           # Dashboard routes (pools, resources, workflows)
│       ├── pools/
│       │   ├── index.ts       # Public API
│       │   ├── page.tsx       # Page component
│       │   ├── hooks/         # Feature hooks
│       │   ├── lib/           # Pure utilities, column configs
│       │   ├── components/    # UI components
│       │   └── stores/        # Zustand stores
│       ├── resources/
│       └── workflows/
├── components/
│   ├── data-table/           # Canonical table component
│   ├── smart-search/         # Search with chip filters
│   ├── dag/                  # DAG visualization
│   ├── panel/                # Resizable panels
│   └── shell/                # App shell (sidebar, header)
├── contexts/                 # DI contexts
├── hooks/                    # Shared hooks
├── lib/
│   ├── api/                  # API client and adapters
│   └── utils.ts              # General utilities
├── stores/                   # Shared Zustand stores
└── test-utils/               # Testing helpers
```

---

## Consolidated Patterns

### URL State Hooks

URL state management is consolidated in `src/hooks/use-url-state.ts`:

```tsx
// Before: 8+ lines per page
const [selection, setSelection] = useQueryState("view",
  parseAsString.withOptions({ shallow: true, history: "push", clearOnDefault: true })
);

// After: 1 line
const { selection, setSelection, config, setConfig, clear } = usePanelState();
```

### Results Count Hook

Results count computation is consolidated in `src/hooks/use-results-count.ts`:

```tsx
// Before: 7 lines
const resultsCount = useMemo<ResultsCount>(
  () => ({ total, filtered: hasActiveFilters ? filteredTotal : undefined }),
  [total, filteredTotal, hasActiveFilters],
);

// After: 1 line
const resultsCount = useResultsCount({ total, filteredTotal, hasActiveFilters });
```

### Table Loading/Error States

Table states are consolidated in `src/components/data-table/TableStates.tsx`:

```tsx
// Before: 25+ lines per table
if (isLoading) { return <div>...</div>; }
if (error) { return <div>...</div>; }

// After: 2 lines
if (isLoading) return <TableLoadingSkeleton rowHeight={rowHeight} />;
if (error) return <TableErrorState error={error} title="Unable to load pools" onRetry={refetch} />;
```

### Chip-to-Filter Conversion

Filter parameter building is consolidated in `src/lib/api/chip-filter-utils.ts`:

```tsx
const POOL_CHIP_MAPPING: ChipMappingConfig<PoolFilterParams> = {
  status: { type: "array", paramKey: "statuses" },
  platform: { type: "array", paramKey: "platforms" },
  search: { type: "single", paramKey: "search" },
};

const filterParams = chipsToParams(searchChips, POOL_CHIP_MAPPING);
```

---

## Feature Module Pattern

### Structure

Each feature follows this structure:

```
feature/
├── index.ts           # Public API exports
├── page.tsx           # Page component
├── error.tsx          # Error boundary
├── hooks/
│   └── use-feature-data.ts
├── lib/
│   ├── constants.ts
│   ├── search-fields.ts
│   └── columns.ts
├── components/
│   ├── table/
│   └── panel/
└── stores/
    └── feature-table-store.ts
```

### Public API

Each feature exports a clean public API:

```typescript
// pools/index.ts
export { usePoolsData } from "./hooks/use-pools-data";
export { MANDATORY_COLUMN_IDS, POOL_COLUMN_SIZE_CONFIG } from "./lib/pool-columns";
export { getStatusDisplay } from "./lib/constants";
export { usePoolsTableStore } from "./stores/pools-table-store";
```

### ESLint Enforcement

Import boundaries are enforced via ESLint:

```javascript
// eslint.config.mjs
{
  patterns: [{
    group: ["@/app/(dashboard)/pools/hooks/*"],
    message: "Import from feature's public API instead."
  }]
}
```

---

## Testing

### Test Providers

Use `TestProviders` for components that need context:

```tsx
import { TestProviders, createMockPool } from '@/test-utils';

test('renders pool', () => {
  const pool = createMockPool({ status: 'ONLINE' });
  render(<PoolCard pool={pool} />, { wrapper: TestProviders });
  expect(screen.getByText('ONLINE')).toBeInTheDocument();
});
```

### Mock Factories

Use factories for consistent test data:

```tsx
import { createMockPool, createMockPools, resetIdCounter } from '@/test-utils';

beforeEach(() => {
  resetIdCounter(); // Consistent IDs across tests
});

test('filters by status', () => {
  const pools = [
    createMockPool({ status: 'ONLINE' }),
    createMockPool({ status: 'OFFLINE' }),
  ];
  // ...
});
```

### Injectable Dependencies

Override dependencies for isolated tests:

```tsx
const mockLayoutCalculator = vi.fn().mockResolvedValue({
  nodes: [{ id: 'node-1', position: { x: 0, y: 0 }, data: {} }],
  edges: [],
});

const { result } = renderHook(() =>
  useDAGState({
    groups: mockGroups,
    layoutCalculator: mockLayoutCalculator,
  })
);

expect(mockLayoutCalculator).toHaveBeenCalledWith(expect.anything(), expect.any(Set), 'TB');
```

---

## Performance Considerations

### Context Splitting

To prevent unnecessary re-renders, contexts are split by concern:

- `ConfigContext` - Rarely changes (app startup)
- `ServiceContext` - Never changes (singleton services)

### Memoization

Expensive computations are memoized:

```tsx
const resultsCount = useMemo(
  () => ({ total, filtered: hasActiveFilters ? filteredTotal : undefined }),
  [total, filteredTotal, hasActiveFilters],
);
```

### Stable Callbacks

Use `useCallback` for callbacks passed to child components:

```tsx
const handleRowClick = useCallback((pool: Pool) => {
  onPoolSelect?.(pool.name);
}, [onPoolSelect]);
```

---

## Migration Guide

When adding a new feature:

1. **Create feature directory** with standard structure
2. **Create `index.ts`** with public API exports
3. **Use consolidated hooks** (`usePanelState`, `useResultsCount`, etc.)
4. **Use consolidated components** (`TableLoadingSkeleton`, `TableErrorState`)
5. **Create feature-specific hooks** with injectable dependencies
6. **Add to ESLint config** for import boundary enforcement

When modifying existing code:

1. **Check for existing utilities** before adding new abstractions
2. **Export from public API** if adding new reusable code
3. **Use dependency injection** for testable logic
4. **Add tests** using `TestProviders` and mock factories
