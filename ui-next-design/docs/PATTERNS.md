# OSMO UI Patterns Reference

> **For Local LLM Use**: Paste relevant sections of this doc into your prompts to give the model context about your codebase patterns.

## Architecture Overview

```
Page → Headless Hook → Adapter Hook → Generated API
            ↓
     Themed Components
```

### Layer Responsibilities

| Layer | Location | Responsibility |
|-------|----------|----------------|
| **Pages** | `src/app/` | Compose hooks + components, minimal logic |
| **Headless hooks** | `src/headless/` | Business logic, filtering, state - NO UI |
| **Adapter hooks** | `src/lib/api/adapter/` | Transform backend quirks to clean types |
| **Generated API** | `src/lib/api/generated.ts` | Auto-generated from OpenAPI, don't edit |
| **Themed components** | `src/components/features/` | Presentation only |

### Import Rules

```typescript
// ✅ Import enums from generated
import { PoolStatus, BackendResourceType } from "@/lib/api/generated";

// ✅ Import transformed types and hooks from adapter
import { usePools, usePool, type Pool, type Resource } from "@/lib/api/adapter";

// ❌ DON'T use raw generated hooks
import { useGetPoolQuotasApiPoolQuotaGet } from "@/lib/api/generated"; // BAD
```

---

## Component Patterns

### 1. Page Component Pattern

Pages are thin - they compose headless hooks and themed components:

```tsx
"use client";

import { usePoolDetail } from "@/headless";
import { VirtualizedResourceTable, QuotaBar } from "@/components/features/pools";
import { FilterBar, ApiError } from "@/components/shared";

export default function PoolDetailPage() {
  const params = useParams();
  const poolName = params.poolName as string;

  const {
    pool,
    filteredResources,
    search,
    setSearch,
    // ... destructure all state/handlers from hook
    isLoading,
    error,
  } = usePoolDetail({ poolName });

  if (error) {
    return <ApiError error={error} onRetry={refetch} />;
  }

  return (
    <div className="flex h-full flex-col gap-6">
      <h1>{poolName}</h1>
      <QuotaBar used={pool?.quota.used} limit={pool?.quota.limit} />
      <VirtualizedResourceTable
        resources={filteredResources}
        isLoading={isLoading}
        filterContent={<FilterBar ... />}
      />
    </div>
  );
}
```

### 2. Headless Hook Pattern

All business logic lives in hooks - NO UI code:

```typescript
export function usePoolDetail({ poolName }: { poolName: string }) {
  // Fetch data via adapter hooks
  const { pool, isLoading, error, refetch } = usePool(poolName);
  const { resources, platforms } = usePoolResources(poolName);

  // Local state
  const [search, setSearch] = useState("");
  const [selectedPlatforms, setSelectedPlatforms] = useState<Set<string>>(new Set());

  // Computed/filtered data
  const filteredResources = useMemo(() => {
    let result = resources;
    if (selectedPlatforms.size > 0) {
      result = result.filter((r) => selectedPlatforms.has(r.platform));
    }
    if (search.trim()) {
      result = result.filter((r) => r.name.toLowerCase().includes(search.toLowerCase()));
    }
    return result;
  }, [resources, search, selectedPlatforms]);

  // Callbacks (memoized)
  const togglePlatform = useCallback((platform: string) => {
    setSelectedPlatforms((prev) => {
      const next = new Set(prev);
      if (next.has(platform)) next.delete(platform);
      else next.add(platform);
      return next;
    });
  }, []);

  // Return everything the UI needs
  return {
    pool,
    filteredResources,
    search,
    setSearch,
    selectedPlatforms,
    togglePlatform,
    isLoading,
    error,
    refetch,
  };
}
```

### 3. Themed Component Pattern

Components receive data and callbacks as props - NO data fetching:

```tsx
interface VirtualizedResourceTableProps {
  resources: Resource[];
  totalCount?: number;
  isLoading?: boolean;
  displayMode?: ResourceDisplayMode;
  onResourceClick?: (resource: Resource) => void;
  filterContent?: React.ReactNode;
}

export function VirtualizedResourceTable({
  resources,
  totalCount,
  isLoading = false,
  displayMode = "free",
  onResourceClick,
  filterContent,
}: VirtualizedResourceTableProps) {
  // Local UI state only (sort, collapse, etc.)
  const [sort, setSort] = useState<SortState>({ column: null, direction: "asc" });

  // Memoize sorted data
  const sortedResources = useMemo(() => {
    if (!sort.column) return resources;
    return [...resources].sort(/* ... */);
  }, [resources, sort]);

  return (
    <div className="...">
      {filterContent}
      <TableContent resources={sortedResources} />
    </div>
  );
}
```

### 4. Filter Bar (Compound Component Pattern)

```tsx
<FilterBar
  activeFilters={activeFilters}
  onRemoveFilter={removeFilter}
  onClearAll={clearAllFilters}
>
  <FilterBar.Search
    value={search}
    onChange={setSearch}
    onClear={clearSearch}
    placeholder="Search resources..."
  />

  <FilterBar.MultiSelect
    icon={Cpu}
    label="Platform"
    options={platforms}
    selected={selectedPlatforms}
    onToggle={togglePlatform}
    onClear={clearPlatformFilter}
  />

  <FilterBar.SingleSelect
    icon={Box}
    label="Type"
    options={resourceTypes}
    value={selectedType}
    onChange={setSelectedType}
  />

  <FilterBar.Actions>
    <FilterBar.Toggle
      label="View by"
      options={[
        { value: "free", label: "Free" },
        { value: "used", label: "Used" },
      ]}
      value={displayMode}
      onChange={setDisplayMode}
    />
  </FilterBar.Actions>
</FilterBar>
```

---

## Performance Patterns

### Memoization

```tsx
// Memoize components that receive objects/arrays
const TableRow = memo(function TableRow({ data }: { data: Resource }) {
  return <div>{data.name}</div>;
});

// Memoize callbacks
const handleClick = useCallback((id: string) => {
  setSelected(id);
}, []);

// Memoize computed values
const sortedItems = useMemo(() => {
  return [...items].sort((a, b) => a.name.localeCompare(b.name));
}, [items]);
```

### Virtualization (Required for Lists > 50 items)

```tsx
import { useVirtualizer } from "@tanstack/react-virtual";

function VirtualList({ items }: { items: Item[] }) {
  const scrollRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 48, // row height
    overscan: 5,
  });

  return (
    <div ref={scrollRef} className="h-full overflow-auto">
      <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
        {virtualizer.getVirtualItems().map((virtualRow) => (
          <div
            key={virtualRow.key}
            style={{
              height: virtualRow.size,
              transform: `translate3d(0, ${virtualRow.start}px, 0)`,
            }}
            className="absolute left-0 right-0"
          >
            {items[virtualRow.index].name}
          </div>
        ))}
      </div>
    </div>
  );
}
```

### Non-blocking Updates

```tsx
// Wrap expensive state updates in startTransition
const handleSort = useCallback((column: SortColumn) => {
  startTransition(() => {
    setSort((prev) => ({ ...prev, column }));
  });
}, []);

// Use useDeferredValue for filter inputs
const [search, setSearch] = useState("");
const deferredSearch = useDeferredValue(search);

const filtered = useMemo(
  () => items.filter((i) => i.name.includes(deferredSearch)),
  [items, deferredSearch]
);
```

---

## Testing Patterns

### E2E Test Structure

```typescript
import { test, expect, createPoolResponse, PoolStatus } from "../fixtures";

test.describe("Feature Name", () => {
  test("does something specific", async ({ page, withData }) => {
    // ARRANGE: Define test data inline
    await withData({
      pools: createPoolResponse([
        { name: "test-pool", status: PoolStatus.ONLINE },
      ]),
    });

    // ACT
    await page.goto("/pools");
    await page.waitForLoadState("networkidle");

    // ASSERT
    await expect(page.getByText("test-pool")).toBeVisible();
  });
});
```

### Mock Data Factories

```typescript
// Create pool response
createPoolResponse([
  { name: "my-pool", status: PoolStatus.ONLINE, description: "My pool" },
])

// Create resources
createResourcesResponse([
  {
    hostname: "node-001.cluster",
    resource_type: BackendResourceType.SHARED,
    allocatable_fields: { gpu: 8, cpu: 128 },
    usage_fields: { gpu: 4, cpu: 64 },
  },
])
```

---

## File Organization

```
src/
├── app/                          # Next.js pages
│   └── (dashboard)/
│       ├── pools/
│       │   ├── page.tsx          # Pools list
│       │   └── [poolName]/
│       │       └── page.tsx      # Pool detail
│       └── resources/
│           └── page.tsx          # All resources
├── components/
│   ├── features/                 # Feature-specific components
│   │   └── pools/
│   │       ├── index.ts
│   │       ├── virtualized-resource-table.tsx
│   │       └── quota-bar.tsx
│   ├── shared/                   # Reusable components
│   │   ├── filter-bar/
│   │   └── api-error.tsx
│   └── ui/                       # shadcn/ui primitives
├── headless/                     # Business logic hooks
│   ├── use-pool-detail.ts
│   └── use-pools-list.ts
└── lib/
    ├── api/
    │   ├── adapter/              # Transform backend responses
    │   │   ├── hooks.ts
    │   │   └── transforms.ts
    │   └── generated.ts          # Auto-generated, don't edit
    ├── constants/
    │   └── ui.ts                 # Display configs
    └── styles.ts                 # Tailwind patterns
```
