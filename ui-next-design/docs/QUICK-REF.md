# Quick Reference Card

> Print this or keep it open during your flight ✈️

## Import Cheat Sheet

```typescript
// Types & Hooks from Adapter
import { usePools, usePool, usePoolResources, useAllResources } from "@/lib/api/adapter";
import type { Pool, Resource, PoolMembership } from "@/lib/api/adapter";

// Enums from Generated (use these, not strings!)
import { PoolStatus, BackendResourceType } from "@/lib/api/generated";

// UI Components
import { VirtualizedResourceTable, QuotaBar } from "@/components/features/pools";
import { FilterBar, ApiError, AdaptiveSummary } from "@/components/shared";
import { Button, Input, Dialog } from "@/components/ui";

// Headless Hooks
import { usePoolDetail, usePoolsList, useAllResources as useAllResourcesHook } from "@/headless";

// Utilities
import { cn, formatCompact } from "@/lib/utils";
import { card, heading, chip, badge, text } from "@/lib/styles";
import { getPoolStatusDisplay, getResourceAllocationTypeDisplay } from "@/lib/constants/ui";
```

## Common Patterns

### Page Structure
```tsx
"use client";
export default function MyPage() {
  const { data, isLoading, error } = useMyHook();
  if (error) return <ApiError error={error} />;
  return <MyComponent data={data} isLoading={isLoading} />;
}
```

### Filter State
```tsx
const [selected, setSelected] = useState<Set<string>>(new Set());
const toggle = useCallback((item: string) => {
  setSelected(prev => {
    const next = new Set(prev);
    next.has(item) ? next.delete(item) : next.add(item);
    return next;
  });
}, []);
```

### Memoized Filter
```tsx
const filtered = useMemo(() => {
  return items.filter(i => selected.size === 0 || selected.has(i.type));
}, [items, selected]);
```

### Memoized Component
```tsx
const Row = memo(function Row({ item }: { item: Item }) {
  return <div>{item.name}</div>;
});
```

## Tailwind Patterns

### Dark Mode
```
bg-white dark:bg-zinc-950
border-zinc-200 dark:border-zinc-800
text-zinc-900 dark:text-zinc-100
text-zinc-500 dark:text-zinc-400
```

### NVIDIA Green
```
bg-[var(--nvidia-green)]
text-[var(--nvidia-green)]
border-[var(--nvidia-green)]
```

### Common Combinations
```tsx
// Card
"rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950"

// Muted text
"text-sm text-zinc-500 dark:text-zinc-400"

// Section heading
"text-xs font-semibold uppercase tracking-wider text-zinc-500"

// Focus ring
"focus-visible:ring-2 focus-visible:ring-[var(--nvidia-green)]"
```

## Test Factories

```typescript
// Pool
createPoolResponse([
  { name: "my-pool", status: PoolStatus.ONLINE, description: "..." }
])

// Resource
createResourcesResponse([
  {
    hostname: "node-001.cluster",
    resource_type: BackendResourceType.SHARED,
    allocatable_fields: { gpu: 8, cpu: 128 },
    usage_fields: { gpu: 4, cpu: 64 },
  }
])
```

## File Locations

| Need | Location |
|------|----------|
| Add a page | `src/app/(dashboard)/[name]/page.tsx` |
| Add headless hook | `src/headless/use-[name].ts` |
| Add feature component | `src/components/features/[feature]/` |
| Add shared component | `src/components/shared/` |
| Add E2E test | `e2e/journeys/[feature].spec.ts` |
| UI constants | `src/lib/constants/ui.ts` |
| Style patterns | `src/lib/styles.ts` |

## Commands

```bash
pnpm dev          # Start dev server
pnpm build        # Build for production
pnpm test         # Run unit tests
pnpm test:e2e     # Run Playwright tests
pnpm generate-api # Regenerate API types from OpenAPI
pnpm lint         # Run ESLint
pnpm format       # Format with Prettier
```
