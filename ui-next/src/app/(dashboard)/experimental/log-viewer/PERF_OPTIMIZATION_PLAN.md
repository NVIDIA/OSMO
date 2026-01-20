<!--
  Copyright (c) 2026, NVIDIA CORPORATION. All rights reserved.

  NVIDIA CORPORATION and its licensors retain all intellectual property
  and proprietary rights in and to this software, related documentation
  and any modifications thereto. Any use, reproduction, disclosure or
  distribution of this software and related documentation without an express
  license agreement from NVIDIA CORPORATION is strictly prohibited.
-->

# Log Viewer Performance Optimization Plan

> **Goal:** Blazing fast log viewer - user sees complete UI chrome instantly (~20ms from CDN) with data filling in progressively.

## Quick Reference

| What | Where |
|------|-------|
| Current page | `src/app/(dashboard)/experimental/log-viewer/page.tsx` |
| Main component | `src/components/log-viewer/components/LogViewer.tsx` |
| Log adapter hooks | `src/lib/api/log-adapter/hooks/` |
| Server prefetch examples | `src/lib/api/server/` (pools.ts, workflows.ts) |
| Streaming SSR examples | `src/app/(dashboard)/pools/page.tsx`, `dashboard-with-data.tsx` |

---

## Current State (Problem)

The log-viewer uses `dynamic()` with `ssr: false` in `log-viewer-playground-loader.tsx`:

```tsx
const LogViewerPlayground = dynamic(() => import("./log-viewer-playground"), {
  ssr: false,  // ❌ Blocks ALL server rendering
  loading: () => <div>Loading...</div>,
});
```

**Result:**
- Zero server rendering - blank screen until JS loads
- No data prefetch - client must hydrate, then fetch
- ~500ms+ before user sees anything meaningful

---

## Data Architecture

**Critical understanding:** There is ONE data source, not multiple APIs.

```
HTTP Log Stream → LogIndex (client-side) → Derived Data
                                            ├── Histogram buckets
                                            ├── Facet values/counts
                                            └── Results count
```

- Logs stream in via HTTP from `/api/workflow/{name}/logs`
- `LogIndex` class parses and indexes entries client-side
- Histogram, facets, and counts are computed FROM the index
- No separate `/histogram` or `/facets` API calls

---

## Static vs Dynamic Breakdown

~80% of the UI is static and can be prerendered.

| Component | Static (PPR Prerendered) | Dynamic (Streams In) |
|-----------|--------------------------|----------------------|
| **QueryBar** | Filter input, chip container, layout | Results count text only |
| **TimelineHistogram** | Container, axis structure | Bar heights/colors |
| **FieldsPane** | Field labels ("level", "source", "task"), collapse button | Values + counts |
| **LogList** | Scroll container, empty state message | Log entry rows |
| **LogToolbar** | All controls (wrap, tail, download, refresh buttons) | Count number, status text |

---

## Target Architecture

### Flow Diagram

```
User Request
     │
     ▼
┌─────────────────────────────────────────────────────────────────┐
│  EDGE/CDN (~20ms)                                               │
│  Returns: PPR Static Shell (prerendered at build time)          │
│  - Complete UI chrome (QueryBar, FieldsPane labels, Toolbar)    │
│  - Shimmer placeholders for dynamic slots                       │
└─────────────────────────────────────────────────────────────────┘
     │
     ▼
┌─────────────────────────────────────────────────────────────────┐
│  SERVER STREAMING (~100-200ms)                                  │
│  - Server fetches initial log batch                             │
│  - Parses logs, dehydrates into TanStack Query cache            │
│  - Streams HTML with HydrationBoundary                          │
└─────────────────────────────────────────────────────────────────┘
     │
     ▼
┌─────────────────────────────────────────────────────────────────┐
│  CLIENT HYDRATION (0 network requests!)                         │
│  - React hydrates with data already in cache                    │
│  - LogIndex built from prefetched entries                       │
│  - Histogram, facets, count computed immediately                │
└─────────────────────────────────────────────────────────────────┘
     │
     ▼
┌─────────────────────────────────────────────────────────────────┐
│  PROGRESSIVE STREAMING (ongoing)                                │
│  - Tailing continues client-side via useLogTail                 │
│  - LogIndex updates progressively                               │
│  - UI updates at 60fps via RAF batching                         │
└─────────────────────────────────────────────────────────────────┘
```

---

## Implementation Tasks

### Task 1: Create Server Prefetch Function

**File:** `src/lib/api/server/logs.ts` (new file)

Follow the pattern from `src/lib/api/server/pools.ts`:

```tsx
// src/lib/api/server/logs.ts
import { QueryClient } from "@tanstack/react-query";
import { parseLogBatch } from "@/lib/api/log-adapter/adapters/log-parser";

const API_URL = process.env.NEXT_PUBLIC_OSMO_API_HOSTNAME 
  ? `https://${process.env.NEXT_PUBLIC_OSMO_API_HOSTNAME}` 
  : "http://localhost:8080";

export async function prefetchLogs(
  queryClient: QueryClient, 
  workflowId: string
): Promise<void> {
  const url = `${API_URL}/api/workflow/${encodeURIComponent(workflowId)}/logs`;
  
  const response = await fetch(url, {
    headers: { Accept: "text/plain" },
  });
  
  if (!response.ok) {
    throw new Error(`Failed to fetch logs: ${response.status}`);
  }
  
  const text = await response.text();
  const entries = parseLogBatch(text, workflowId);
  
  // Prefill the query cache - client will hydrate with this data
  queryClient.setQueryData(["logs", workflowId], {
    entries,
    hasMore: false, // Initial batch, tailing handles more
  });
}
```

**Export from:** `src/lib/api/server/index.ts`

---

### Task 2: Create Skeleton Component

**File:** `src/app/(dashboard)/experimental/log-viewer/log-viewer-skeleton.tsx` (new file)

The skeleton should render the EXACT same layout as the final component to prevent layout shift (CLS = 0).

```tsx
// log-viewer-skeleton.tsx
import { Skeleton } from "@/components/shadcn/skeleton";
import { 
  ROW_HEIGHT_ESTIMATE, 
  HISTOGRAM_HEIGHT 
} from "@/components/log-viewer/lib/constants";

export function LogViewerSkeleton() {
  return (
    <div className="flex h-full flex-col p-4">
      <div className="border-border bg-card h-full overflow-hidden rounded-lg border">
        <div className="flex h-full flex-col">
          {/* QueryBar skeleton - height matches real QueryBar */}
          <div className="shrink-0 border-b px-3 py-2">
            <div className="flex items-center gap-2">
              <Skeleton className="h-9 flex-1" /> {/* Filter input */}
              <Skeleton className="h-5 w-20" />   {/* "-- results" */}
            </div>
          </div>

          {/* Histogram skeleton - exact height from constants */}
          <div className="shrink-0 border-b px-3 py-2" style={{ height: HISTOGRAM_HEIGHT + 16 }}>
            <div className="flex h-full items-end gap-1">
              {Array.from({ length: 30 }).map((_, i) => (
                <Skeleton 
                  key={i} 
                  className="flex-1" 
                  style={{ height: `${20 + Math.random() * 60}%` }} 
                />
              ))}
            </div>
          </div>

          {/* Main content area */}
          <div className="flex min-h-0 flex-1">
            {/* FieldsPane skeleton - exact width (w-48 = 192px) */}
            <div className="w-48 shrink-0 border-r p-3 space-y-4">
              {["level", "source", "task"].map((field) => (
                <div key={field} className="space-y-2">
                  <span className="text-xs font-medium text-muted-foreground">{field}</span>
                  {Array.from({ length: 3 }).map((_, i) => (
                    <div key={i} className="flex items-center justify-between">
                      <Skeleton className="h-4 w-16" />
                      <Skeleton className="h-4 w-8" />
                    </div>
                  ))}
                </div>
              ))}
            </div>

            {/* LogList skeleton - rows match ROW_HEIGHT_ESTIMATE */}
            <div className="flex-1 p-2 space-y-1">
              {Array.from({ length: 15 }).map((_, i) => (
                <Skeleton 
                  key={i} 
                  className="w-full" 
                  style={{ height: ROW_HEIGHT_ESTIMATE }} 
                />
              ))}
            </div>
          </div>

          {/* Toolbar skeleton - static controls visible */}
          <div className="shrink-0 border-t px-3 py-2">
            <div className="flex items-center justify-between">
              <div className="flex gap-2">
                <Skeleton className="h-8 w-8" />
                <Skeleton className="h-8 w-8" />
                <Skeleton className="h-8 w-8" />
              </div>
              <Skeleton className="h-4 w-24" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
```

---

### Task 3: Create Async Server Component

**File:** `src/app/(dashboard)/experimental/log-viewer/log-viewer-with-data.tsx` (new file)

Follow the pattern from `src/app/(dashboard)/dashboard-with-data.tsx`:

```tsx
// log-viewer-with-data.tsx
import { dehydrate, QueryClient, HydrationBoundary } from "@tanstack/react-query";
import { prefetchLogs } from "@/lib/api/server/logs";
import { LogViewerPlayground } from "./log-viewer-playground";

// Mock workflow ID for playground - in production this comes from route params
const MOCK_WORKFLOW_ID = "log-viewer-playground";

export async function LogViewerWithData() {
  const queryClient = new QueryClient();

  // This await causes the component to suspend
  // While suspended, the Suspense fallback (skeleton) is shown
  await prefetchLogs(queryClient, MOCK_WORKFLOW_ID);

  // Wrap in HydrationBoundary so client gets the cached data
  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <LogViewerPlayground />
    </HydrationBoundary>
  );
}
```

---

### Task 4: Restructure page.tsx

**File:** `src/app/(dashboard)/experimental/log-viewer/page.tsx` (modify)

```tsx
// page.tsx
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { LogViewerSkeleton } from "./log-viewer-skeleton";
import { LogViewerWithData } from "./log-viewer-with-data";

export default function LogViewerExperimentalPage() {
  // Redirect to home in production
  if (process.env.NODE_ENV === "production") {
    redirect("/");
  }

  // No await - returns immediately with skeleton
  // LogViewerWithData suspends and streams when data is ready
  return (
    <Suspense fallback={<LogViewerSkeleton />}>
      <LogViewerWithData />
    </Suspense>
  );
}
```

---

### Task 5: Delete SSR Disable Wrapper

**File:** `src/app/(dashboard)/experimental/log-viewer/log-viewer-playground-loader.tsx` (DELETE)

This file exists solely to disable SSR. Remove it entirely.

---

### Task 6: Make LogViewerPlayground Hydration-Safe

**File:** `src/app/(dashboard)/experimental/log-viewer/log-viewer-playground.tsx` (modify)

The `ScenarioSelector` uses Radix Select which can cause hydration mismatches. Wrap it:

```tsx
import { useMounted } from "@/hooks";

// In LogViewerPlayground component:
const mounted = useMounted();

const headerActions = useMemo(
  () => mounted ? (
    <ScenarioSelector value={scenario} onChange={setScenario} />
  ) : (
    // Placeholder during SSR/hydration
    <div className="h-9 w-32 animate-pulse rounded bg-muted" />
  ),
  [scenario, setScenario, mounted],
);
```

Similarly for any DropdownMenu, Select, or other Radix portal components.

---

### Task 7: Add Micro-Suspense Boundaries (Optional Enhancement)

**File:** `src/components/log-viewer/components/LogViewer.tsx` (modify)

For even faster perceived performance, add Suspense around dynamic-only parts:

```tsx
// In LogViewerInner:

// Results count with its own boundary
<Suspense fallback={<span className="text-muted-foreground">-- results</span>}>
  <ResultsCount total={resultsCount.total} filtered={resultsCount.filtered} />
</Suspense>

// Histogram with its own boundary
{histogram && histogram.buckets.length > 0 && (
  <Suspense fallback={<HistogramSkeleton />}>
    <TimelineHistogram
      buckets={histogram.buckets}
      intervalMs={histogram.intervalMs}
      onBucketClick={handleBucketClick}
      height={80}
    />
  </Suspense>
)}
```

---

## Performance Targets

| Metric | Current | Target | How Achieved |
|--------|---------|--------|--------------|
| TTFB | ~500ms | ~20ms | PPR static shell served from CDN |
| First paint | ~800ms | ~50ms | Static chrome visible immediately |
| First logs visible | ~1.2s | ~200ms | Server prefetch + HydrationBoundary |
| Client network requests | 1+ | 0 (initial) | Data in hydrated cache |
| CLS (layout shift) | 0.1+ | 0 | Skeleton matches final layout exactly |

---

## Testing the Implementation

1. **Build and check PPR output:**
   ```bash
   cd external/ui-next
   pnpm build
   # Check build output - should show static/dynamic breakdown
   ```

2. **Test with network throttling:**
   - Open DevTools > Network > Slow 3G
   - Navigate to `/experimental/log-viewer`
   - Skeleton should appear almost instantly
   - Content should stream in progressively

3. **Check HydrationBoundary works:**
   - Network tab should show NO fetch calls after hydration
   - Data should be visible immediately from cache

4. **Verify CLS = 0:**
   - DevTools > Lighthouse > Performance
   - Run audit, check Cumulative Layout Shift

---

## Files Summary

| File | Action | Purpose |
|------|--------|---------|
| `src/lib/api/server/logs.ts` | CREATE | Server-side log prefetch |
| `src/lib/api/server/index.ts` | MODIFY | Export prefetchLogs |
| `log-viewer-skeleton.tsx` | CREATE | Precise skeleton component |
| `log-viewer-with-data.tsx` | CREATE | Async server component |
| `page.tsx` | MODIFY | Add Suspense wrapper |
| `log-viewer-playground-loader.tsx` | DELETE | Remove SSR disable |
| `log-viewer-playground.tsx` | MODIFY | Hydration-safe Radix |

---

## Reference: Existing Patterns to Follow

### Server Prefetch Pattern
See: `src/lib/api/server/pools.ts`, `src/lib/api/server/workflows.ts`

### Streaming SSR Pattern  
See: `src/app/(dashboard)/pools/page.tsx` + `pools-with-data.tsx`

### Hydration-Safe Radix
See: `src/components/chrome/chrome.tsx` (uses `useMounted()`)

### Skeleton Components
See: `src/app/(dashboard)/dashboard-skeleton.tsx`, `pools-page-skeleton.tsx`
