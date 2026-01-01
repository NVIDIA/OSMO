# Pools Page Redesign - Implementation Specification

> **Status:** Ready for Implementation  
> **Last Updated:** 2025-12-31  
> **Target:** `src/app/(dashboard)/pools/page.tsx`

---

## TL;DR for LLM Implementers

Build a **sectioned table** for pools using **generic, reusable primitives**:

1. **TanStack Table** (already installed) for table logic (sorting, filtering, column resize)
2. **Zustand** (already installed) for user preference persistence (column visibility, widths)
3. **nuqs** (already installed) for URL state (shareable filters, deep-linkable panels)
4. **cmdk** (already installed as `command.tsx`) for smart search autocomplete
5. **Minimal custom code** only for pools-specific rendering

**🔑 KEY PRINCIPLE:** Build generic primitives FIRST (`ui/`), then compose pools-specific components (`features/pools/`):

| Generic Primitive | Location | Pools Consumer |
|-------------------|----------|----------------|
| `SmartSearch<T>` | `ui/smart-search/` | `pool-search-fields.ts` |
| `DataTable<T>` | `ui/data-table/` | `pool-columns.ts` |
| `ResizablePanel` | `ui/resizable-panel/` | `PoolPanel.tsx` |
| `createTableStore()` | `lib/stores/` | `pools-table-store.ts` |

**⚠️ CRITICAL: Read these sections before implementing:**
- [Maximize Library Usage](#maximize-library-usage-minimize-custom-code) — **USE LIBRARIES FIRST, write custom code LAST**
- [Generic Components & Reusability](#generic-components--reusability) — Build generic primitives, pools is first consumer
- [Codebase Architecture & Patterns](#codebase-architecture--patterns) — Three-layer architecture, **layer isolation rules**
- [Zustand Store Best Practices](#zustand-store-best-practices) — Store factory, selectors, persist, immer
- [Styling & Design System](#styling--design-system) — Use `src/lib/styles.ts`, zinc palette, **EVERY color needs dark: variant**
- [Best Practices & Performance Optimizations](#best-practices--performance-optimizations) — CSS containment, memoization, caching

**🚫 LAYER ISOLATION:** Do NOT cross-contaminate layers!
- **UI** = styling only, no `.filter()`, no `.sort()`, no business logic
- **Headless** = business logic only, no JSX, no `className`
- **Adapter** = data shape transforms only, no filtering, no business logic

**📦 LIBRARY FIRST:** Before writing ANY custom code, check:
- **Sorting/Filtering?** → TanStack Table (`getSortedRowModel`, `getFilteredRowModel`)
- **Column visibility/resize?** → TanStack Table (built-in state)
- **Omni search with chips?** → cmdk as inline search (NOT modal)
- **Panel resizing?** → react-resizable-panels
- **Collapsible sections?** → Radix Collapsible
- **URL state?** → nuqs (already installed)
- **Progress bars?** → Radix Progress

Key patterns to apply:
- **CSS data-attributes** for status styling (no JS recalculation)
- **CSS containment** for layout isolation
- **Context for callbacks** to prevent re-renders
- **Pre-computed lookup maps** for O(1) access
- **Single-pass computation** for derived data
- **Aggressive memoization** with custom comparison
- **Pure functions outside components**

Key files to reference:
- `src/app/(dashboard)/dev/workflow-explorer/reactflow-dag/components/GroupPanel/TaskTable.tsx` - virtualization, DND columns, memoization
- `src/app/(dashboard)/dev/workflow-explorer/reactflow-dag/components/GroupPanel/SmartSearch.tsx` - chip-based filtering, lazy loading
- `src/app/(dashboard)/dev/workflow-explorer/reactflow-dag/components/GroupPanel/column-config.ts` - width shares system, caching
- `src/app/(dashboard)/dev/workflow-explorer/reactflow-dag/components/DetailsPanel/DetailsPanel.tsx` - resizable panel
- `src/app/(dashboard)/dev/workflow-explorer/reactflow-dag/components/DetailsPanel/DetailsPanelHeader.tsx` - kebab menu, snap presets
- `src/app/(dashboard)/dev/workflow-explorer/reactflow-dag/hooks/use-resizable-panel.ts` - panel resize hook, RAF throttling
- `src/app/(dashboard)/dev/workflow-explorer/reactflow-dag/dag.css` - CSS custom properties, containment, data-attributes
- `src/app/(dashboard)/dev/workflow-explorer/reactflow-dag/context.tsx` - stable callback pattern
- `src/app/(dashboard)/dev/workflow-explorer/reactflow-dag/utils/status.tsx` - pure functions, lookup maps, single-pass computation

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Technology Stack](#technology-stack)
3. [Data Model](#data-model)
4. [UI Specifications](#ui-specifications)
5. [Panel Resizing](#panel-resizing)
6. [Column Resizing](#column-resizing)
7. [Component Structure](#component-structure)
8. [Patterns to Preserve](#patterns-to-preserve)
9. [Generic Components & Reusability](#generic-components--reusability)
10. [Codebase Architecture & Patterns](#codebase-architecture--patterns)
11. [Zustand Store Best Practices](#zustand-store-best-practices)
12. [Styling & Design System](#styling--design-system)
13. [Best Practices & Performance Optimizations](#best-practices--performance-optimizations)
14. [Maximize Library Usage](#maximize-library-usage-minimize-custom-code)
15. [Implementation Checklist](#implementation-checklist)

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              Architecture                                    │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│   ┌──────────────────┐    ┌──────────────────┐    ┌──────────────────────┐  │
│   │     Zustand      │───▶│   TanStack Table │───▶│   Custom Rendering   │  │
│   │     Store        │    │      (Logic)     │    │     (Your JSX)       │  │
│   └──────────────────┘    └──────────────────┘    └──────────────────────┘  │
│           │                       │                         │                │
│           ▼                       ▼                         ▼                │
│   • columnOrder           • Sorting logic           • DND column headers     │
│   • columnVisibility      • Filtering logic         • Smart search chips     │
│   • columnUserWidths      • Row models              • Virtualized rows       │
│   • sorting               • Multi-sort              • CSS grid + minmax      │
│   • panelPct              • Column resizing         • Status sections        │
│   • collapsedSections     • Server-side ready       • Progress bars          │
│   • displayMode                                     • Resizable panel        │
│   • compactMode                                                              │
│   • persist middleware                                                       │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Why This Stack?

| Layer | Technology | Rationale |
|-------|------------|-----------|
| **State** | Zustand | Persist middleware for localStorage, devtools, cross-component access |
| **Logic** | TanStack Table | Battle-tested sorting/filtering, multi-sort, column resizing, server-side ready |
| **Rendering** | Custom JSX | Preserve our DND columns, smart search chips, column width shares, virtualization |

---

## Technology Stack

### Already Installed ✅

```json
{
  "@tanstack/react-table": "^8.21.3",   // Table logic (sorting, filtering, resizing)
  "@tanstack/react-virtual": "^3.13.13", // Virtualization
  "@dnd-kit/core": "^6.3.1",             // Drag and drop
  "@dnd-kit/sortable": "^10.0.0",        // Column reordering
  "chrono-node": "^2.9.0",               // Date parsing for smart search
  "zustand": "^5.0.9",                   // State management
  "nuqs": "^2.8.6",                      // URL state management
  "cmdk": "^1.1.1",                      // Smart search (via command.tsx)
  "zod": "^4.2.1"                        // Validation
}
```

### Needs Installation ❌

```bash
cd /Users/fernandol/Workspace/osmo/external/ui-next

# Immer for Zustand mutations
pnpm add immer

# Panel resizing library
pnpm add react-resizable-panels

# Radix primitives
pnpm add @radix-ui/react-collapsible @radix-ui/react-progress @radix-ui/react-scroll-area

# Shadcn components (wraps Radix)
npx shadcn@latest add collapsible progress scroll-area
```

---

## Data Model

### Backend API Response

The backend returns pools grouped by `node_sets` (pools sharing physical hardware):

```typescript
// Backend types (from API)
interface PoolResponse {
  node_sets: PoolNodeSetResourceUsage[];
  resource_sum: ResourceUsage;
}

interface PoolNodeSetResourceUsage {
  pools: PoolResourceUsage[];  // Pools in same node_set share capacity
}

interface ResourceUsage {
  quota_used: string;      // NORMAL/HIGH priority jobs using quota
  quota_free: string;      // Remaining quota allocation
  quota_limit: string;     // Guaranteed GPU allocation
  total_usage: string;     // All jobs (including LOW priority borrowing)
  total_capacity: string;  // Physical GPUs (shared within node_set)
  total_free: string;      // Idle GPUs available for borrowing
}
```

### Transformed UI Types

Transform backend response to flat list + sharing info:

```typescript
// File: src/lib/api/adapter/types.ts (update existing)

interface PoolsResponse {
  pools: Pool[];
  sharingGroups: string[][];  // Groups of pool names that share capacity
}

interface Pool {
  // Identity
  name: string;
  description: string;
  status: PoolStatus;  // ONLINE | MAINTENANCE | OFFLINE
  backend: string;     // k8s, slurm, etc.

  // Platforms
  platforms: string[];
  platformConfigs: Record<string, PlatformConfig>;

  // Quota (per-pool, for NORMAL/HIGH priority jobs)
  quotaUsed: number;
  quotaFree: number;
  quotaLimit: number;

  // Capacity (shared within node_set, for LOW priority jobs)
  totalUsage: number;
  totalCapacity: number;
  totalFree: number;
}
```

### Transform Function

```typescript
// File: src/lib/api/adapter/transforms.ts (update existing)

export function transformPoolsResponse(rawResponse: unknown): PoolsResponse {
  const response = rawResponse as PoolResponse | undefined;
  if (!response?.node_sets) {
    return { pools: [], sharingGroups: [] };
  }

  const pools: Pool[] = [];
  const sharingGroups: string[][] = [];
  
  for (const nodeSet of response.node_sets) {
    const nodeSetPools = nodeSet.pools ?? [];
    const poolNames = nodeSetPools.map(p => p.name ?? "").filter(Boolean);
    
    // Track sharing if multiple pools in node_set
    if (poolNames.length > 1) {
      sharingGroups.push(poolNames);
    }
    
    for (const backendPool of nodeSetPools) {
      pools.push(transformPool(backendPool));
    }
  }
  
  return { pools, sharingGroups };
}

// Helper for UI
export function getSharingInfo(
  poolName: string, 
  sharingGroups: string[][]
): string[] | null {
  const group = sharingGroups.find(g => g.includes(poolName));
  if (!group || group.length <= 1) return null;
  return group.filter(name => name !== poolName);
}
```

---

## UI Specifications

### Layout Structure

**UNIFIED TABLE with Sticky Headers:**
- Table header: ALWAYS sticky at top (z-index: 20)
- Section rows: Sticky below header while scrolling that section (z-index: 10)
- Sections naturally push each other as you scroll

```
┌──────────────────────────────────────────────────────────────────────────────────────┐
│ [🔍 status:ONLINE] [platform:arm64]              [× clear]   [used ⟷ free] [compact] │
├══════════════════════════════════════════════════════════════════════════════════════┤
│ POOL ▴        │ DESCRIPTION      │ QUOTA (GPU) ▼ │ CAPACITY (GPU) │ PLATFORMS│BACKEND│  ← STICKY (always)
├──────────────────────────────────────────────────────────────────────────────────────┤
│ ▼ 🟢 Online (4)                                                                       │  ← STICKY (in section)
├──────────────────────────────────────────────────────────────────────────────────────┤
│ pool-dev      │ Development      │ ██░░░░ 80 free│ ███░░░░ 120 idl│[arm64]+2 │ k8s   │
│ pool-staging  │ Staging env      │ █████░ 50 free│ █████░░ 80 idle│[x86]+1   │ k8s   │
│ pool-prod     │ Production       │ ████████20 fre│ ███████ 20 idle│[arm][x86]│ k8s   │
│ pool-batch    │ Batch processing │ ██████████ 0  │ █████████ 10 🔗│[x86]+3   │ k8s   │  ← 🔗 = shared
├──────────────────────────────────────────────────────────────────────────────────────┤
│ ▼ 🟡 Maintenance (1)                                                                  │  ← STICKY (pushes Online)
├──────────────────────────────────────────────────────────────────────────────────────┤
│ pool-test     │ Testing env      │ ██░░░░░░ idle │ ████████░░ 0   │[x86]     │ slurm │
├──────────────────────────────────────────────────────────────────────────────────────┤
│ ▶ 🔴 Offline (0)                                                        [collapsed]  │
└──────────────────────────────────────────────────────────────────────────────────────┘
```

**Scroll Behavior:**
```
Initial view:
┌─────────────────────────────────────────────────┐
│ TABLE HEADER                    ← always sticky │
├─────────────────────────────────────────────────┤
│ 🟢 Online (5)                   ← sticky now    │
│ pool-1, pool-2, pool-3...                       │
└─────────────────────────────────────────────────┘

Scrolled into Online section:
┌─────────────────────────────────────────────────┐
│ TABLE HEADER                    ← always sticky │
├─────────────────────────────────────────────────┤
│ 🟢 Online (5)                   ← sticky        │
│ pool-3, pool-4, pool-5                          │
│ 🟡 Maintenance (2)              ← visible       │
└─────────────────────────────────────────────────┘

Scrolled past Online:
┌─────────────────────────────────────────────────┐
│ TABLE HEADER                    ← always sticky │
├─────────────────────────────────────────────────┤
│ 🟡 Maintenance (2)              ← sticky now    │
│ pool-m1, pool-m2                                │
│ 🔴 Offline (1)                  ← visible       │
└─────────────────────────────────────────────────┘
```

### User Journeys

| Journey | Question | Metric | Column |
|---------|----------|--------|--------|
| **NORMAL/HIGH Priority** | "How much quota can I use?" | `quota_free` | QUOTA (free mode) |
| **NORMAL/HIGH Priority** | "Which pool has room?" | Sort by `quota_free` desc | QUOTA column |
| **LOW Priority** | "How much can I borrow?" | `total_free` | CAPACITY (free mode) |
| **LOW Priority** | "Which pool has idle GPUs?" | Sort by `total_free` desc | CAPACITY column |

### Column Definitions

```typescript
const POOL_COLUMNS: ColumnConfig[] = [
  // Mandatory columns (not draggable, not hideable)
  { id: "pool", header: "Pool", min: 140, share: 1, sortable: true, mandatory: true, resizable: true },
  
  // Optional columns (draggable, hideable, resizable)
  { id: "description", header: "Description", min: 120, share: 2, sortable: false, defaultVisible: true, resizable: true },
  { id: "quota", header: "Quota (GPU)", min: 120, share: 0, sortable: true, defaultVisible: true, resizable: true },
  { id: "capacity", header: "Capacity (GPU)", min: 120, share: 0, sortable: true, defaultVisible: true, resizable: true },
  { id: "platforms", header: "Platforms", min: 100, share: 1, sortable: true, defaultVisible: true, resizable: true },
  { id: "backend", header: "Backend", min: 80, share: 0, sortable: true, defaultVisible: false, resizable: true },
];
```

### Display Modes

**Toggle affects number display in both Quota and Capacity columns:**

| Mode | Quota Column | Capacity Column |
|------|--------------|-----------------|
| **Used** | `██████░░ 80/100` (used/limit) | `████████░░ 150/200` (used/capacity) |
| **Free** | `██████░░ 20 free` (available) | `████████░░ 50 idle` (borrowable) |

### Compact Mode

| Aspect | Normal | Compact |
|--------|--------|---------|
| Row height | 48px | 32px |
| GPU columns | Progress bar + number | Number only |
| Font size | text-sm | text-xs |

### Sharing Indicator

Pools sharing capacity show `🔗` icon in Capacity column:

```
│ CAPACITY (GPU)     │
│ ██████░░ 50 idle   │  ← Not shared
│ ██████░░ 50 idle 🔗│  ← Shared (hover for tooltip)
```

**Tooltip content:**
```
┌────────────────────────────────────┐
│ 🔗 Shares capacity with:           │
├────────────────────────────────────┤
│ pool-b      🔧 Maintenance         │
│ pool-d      🔴 Offline             │
├────────────────────────────────────┤
│ Total: 200 GPUs                    │
│ Used: 150 · Idle: 50               │
└────────────────────────────────────┘
```

### Platform Pills (Responsive)

```
Narrow:    [linux-arm64] +3
Medium:    [linux-arm64] [linux-x86_64] +2  show less
Wide:      [linux-arm64] [darwin-arm64] [linux-x86_64] [windows-x64]
```

- Alphabetically sorted
- Auto-expand as column widens
- "show less" collapses to minimum

### Status Sections

- Groups: Online → Maintenance → Offline
- Collapsible with chevron
- **Empty sections: hidden completely**
- Count badge: `🟢 Online (3)`

---

## Panel Resizing

### Decision: Overlay Panel with Resize Handle

The details panel is an **overlay** that does NOT affect table width. Panel resizing is independent of column resizing.

### Panel Configuration

```typescript
// Constants (from workflow-explorer)
const PANEL = {
  DEFAULT_WIDTH_PCT: 50,   // Initial width: 50% of viewport
  MIN_WIDTH_PCT: 25,       // Can't shrink below 25%
  MAX_WIDTH_PCT: 80,       // Can't grow beyond 80%
  WIDTH_PRESETS: [33, 50, 75] as const,  // Quick snap options
} as const;
```

### Panel Features (Reuse from DetailsPanel)

1. **Drag Handle**
   - Vertical bar on left edge of panel
   - `cursor-ew-resize` on hover
   - Grip icon appears on hover
   - Blue highlight during drag

2. **RAF-Throttled Dragging** (from `use-resizable-panel.ts`)
   - 60fps smooth resize via `requestAnimationFrame`
   - Percentage-based sizing for responsive layouts
   - Passive event listeners for scroll performance

3. **Kebab Menu** (from `DetailsPanelHeader.tsx`)
   - Column visibility submenu (checkboxes)
   - "Snap to" width presets with icons:
     - 33% → `PanelLeftClose` icon
     - 50% → `Columns2` icon  
     - 75% → `PanelLeft` icon

4. **Persistence**
   - Panel width saved to Zustand store → localStorage
   - Restored on page reload

### Panel Resize Implementation

```typescript
// From: src/app/(dashboard)/dev/workflow-explorer/reactflow-dag/hooks/use-resizable-panel.ts

export function useResizablePanel({
  initialPct = 50,
  minPct = 25,
  maxPct = 80,
  persist = true,
}: UseResizablePanelOptions = {}): UseResizablePanelReturn {
  const [panelPct, setPanelPct] = usePersistedState("panelPct", initialPct);
  const [isDragging, setIsDragging] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number | null>(null);
  const pendingPctRef = useRef<number | null>(null);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const pct = 100 - (x / rect.width) * 100;
      pendingPctRef.current = Math.min(maxPct, Math.max(minPct, pct));

      if (rafRef.current === null) {
        rafRef.current = requestAnimationFrame(() => {
          if (pendingPctRef.current !== null) {
            setPanelPct(pendingPctRef.current);
          }
          rafRef.current = null;
        });
      }
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };

    document.addEventListener("mousemove", handleMouseMove, { passive: true });
    document.addEventListener("mouseup", handleMouseUp);

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isDragging, minPct, maxPct, setPanelPct]);

  return { panelPct, setPanelPct, isDragging, handleMouseDown, containerRef };
}
```

### Panel JSX Structure

```tsx
// Resize Handle (from DetailsPanel.tsx)
<div
  className={cn(
    "group absolute top-0 z-20 h-full w-1 cursor-ew-resize",
    isDragging ? "bg-blue-500" : "bg-transparent hover:bg-gray-400 dark:hover:bg-zinc-600",
  )}
  style={{
    left: `${100 - panelPct}%`,
    transform: "translateX(-50%)",
    willChange: isDragging ? "left" : "auto",
  }}
  onMouseDown={handleMouseDown}
  role="separator"
  aria-orientation="vertical"
  aria-label="Resize panel"
  aria-valuenow={panelPct}
  aria-valuemin={25}
  aria-valuemax={80}
>
  <div
    className={cn(
      "absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded bg-gray-300 dark:bg-zinc-700 px-0.5 py-1 shadow-md transition-opacity duration-150",
      isDragging ? "opacity-100" : "opacity-0 group-hover:opacity-100",
    )}
  >
    <GripVertical className="size-4 text-gray-600 dark:text-zinc-300" />
  </div>
</div>

{/* Panel Container */}
<aside
  className="absolute inset-y-0 right-0 z-10 flex flex-col overflow-hidden border-l bg-white/95 dark:bg-zinc-900/95 backdrop-blur"
  style={{ width: `${panelPct}%` }}
  role="complementary"
>
  {/* Panel content */}
</aside>
```

---

## Column Resizing

### Decision: Dual-Mode Column Resizing with Share System

Column resizing uses a **dual-mode approach** that complements the share-based width system:

| User Action | Mode | Behavior |
|-------------|------|----------|
| **Drag WIDER** than share allocation | `min` mode | Sets new floor, share preserved, still responsive |
| **Drag NARROWER** than share allocation | `fixed` mode | Becomes fixed pixel width, no share growth |
| **Double-click** resize handle | Reset | Returns to config defaults |

### Why Dual-Mode?

The share system uses `minmax(Xpx, Yfr)` where:
- `X` = minimum floor (never smaller)
- `Y` = share of remaining space (ceiling for growth)

**Problem:** If user drags narrower than share allocation, the share would grow it back!

**Solution:** Detect resize direction and switch modes:
- Wider → new min, share preserved → column still grows with window
- Narrower → fixed width → column stays exactly that size

### Column Width Types

```typescript
/**
 * Column width configuration.
 */
interface ColumnWidthConfig {
  min: number;    // Original minimum from config (e.g., 150)
  share: number;  // Growth ratio (e.g., 2.8)
}

/**
 * User override from manual resize.
 */
interface ColumnUserWidth {
  value: number;           // The width user dragged to
  mode: 'min' | 'fixed';   // How to interpret it
}

/**
 * State shape for column user widths.
 * Key: column ID, Value: user override
 */
type ColumnUserWidths = Record<string, ColumnUserWidth>;
```

### Resize Handler

```typescript
/**
 * Handle column resize from drag.
 * Determines mode based on resize direction.
 */
function handleColumnResize(
  columnId: string,
  newWidth: number,
  previousWidth: number,
  configMin: number,
) {
  const isGrowing = newWidth > previousWidth;
  
  setColumnUserWidths(prev => ({
    ...prev,
    [columnId]: {
      value: Math.max(newWidth, configMin),  // Never below config min
      mode: isGrowing ? 'min' : 'fixed',
    },
  }));
}

/**
 * Reset column to config defaults (double-click).
 */
function handleColumnResizeReset(columnId: string) {
  setColumnUserWidths(prev => {
    const next = { ...prev };
    delete next[columnId];
    return next;
  });
}
```

### Grid Template Generation

```typescript
/**
 * Build CSS grid template respecting user overrides.
 */
function buildGridTemplate(
  columns: ColumnDef[],
  userWidths: ColumnUserWidths,
): string {
  return columns.map(col => {
    const config = col.meta as ColumnWidthConfig;
    const user = userWidths[col.id];
    
    // No user override → use config
    if (!user) {
      if (typeof config === 'number') return `${config}px`;
      return `minmax(${config.min}px, ${config.share}fr)`;
    }
    
    // Fixed mode → exact pixel width (no share growth)
    if (user.mode === 'fixed') {
      return `${user.value}px`;
    }
    
    // Min mode → new floor, share preserved
    return `minmax(${user.value}px, ${config.share}fr)`;
  }).join(' ');
}
```

### Visual Behavior

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                     Manual Resize Behavior                                   │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│   Initial: minmax(150px, 2.8fr) → Column gets ~600px from share             │
│                                                                              │
│   Drag WIDER to 800px:                                                       │
│   ┌──────────────────────────────────────────────────────────────────────┐  │
│   │ minmax(800px, 2.8fr)                                                 │  │
│   │ • Column is at least 800px                                           │  │
│   │ • Still grows with share when window widens                          │  │
│   │ • Responsive ✓                                                       │  │
│   └──────────────────────────────────────────────────────────────────────┘  │
│                                                                              │
│   Drag NARROWER to 300px:                                                    │
│   ┌──────────────────────────────────────────────────────────────────────┐  │
│   │ 300px (fixed)                                                        │  │
│   │ • Column is exactly 300px                                            │  │
│   │ • Does NOT grow with share                                           │  │
│   │ • Other columns absorb the freed space                               │  │
│   └──────────────────────────────────────────────────────────────────────┘  │
│                                                                              │
│   Double-click to reset:                                                     │
│   ┌──────────────────────────────────────────────────────────────────────┐  │
│   │ minmax(150px, 2.8fr) ← Back to config                                │  │
│   │ • Original responsive behavior restored                              │  │
│   └──────────────────────────────────────────────────────────────────────┘  │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### TanStack Table Column Resizing Integration

TanStack Table provides built-in column resizing that can be combined with our share system:

```typescript
const table = useReactTable({
  columns,
  data,
  enableColumnResizing: true,
  columnResizeMode: 'onChange',  // Real-time updates
  columnResizeDirection: 'ltr',
  
  // ... other options
});

// In header cell, attach resize handler:
<div
  onMouseDown={header.getResizeHandler()}
  onTouchStart={header.getResizeHandler()}
  className={cn(
    "absolute right-0 top-0 h-full w-1 cursor-col-resize",
    header.column.getIsResizing() && "bg-blue-500",
  )}
/>
```

### Persistence

Column user widths are persisted to localStorage:

```typescript
// In Zustand store
interface PoolsTableState {
  // ... other state
  columnUserWidths: ColumnUserWidths;  // { pool: { value: 300, mode: 'fixed' } }
}

// Partialize for persistence
partialize: (state) => ({
  // ... other persisted state
  columnUserWidths: state.columnUserWidths,
})
```

---

## Component Structure

```
src/
├── components/
│   ├── ui/
│   │   └── data-table/                    # Generic reusable table
│   │       ├── index.ts
│   │       ├── DataTable.tsx              # Main component
│   │       ├── DataTableHeader.tsx        # Sortable, draggable, resizable headers
│   │       ├── DataTableBody.tsx          # Virtualized body
│   │       ├── SmartSearch.tsx            # Generalized chip-based search
│   │       ├── column-utils.ts            # Grid template from shares + user widths
│   │       └── types.ts                   # Generic column types
│   │
│   └── features/
│       └── pools/
│           ├── PoolsTable.tsx             # Pools-specific table
│           ├── PoolsTableStore.ts         # Zustand store
│           ├── PoolPanel.tsx              # Slide-in details (resizable)
│           ├── PoolPanelHeader.tsx        # Header with kebab menu + snap presets
│           ├── PoolRow.tsx                # Row with GPU cells
│           ├── GpuProgressCell.tsx        # Progress bar + number
│           ├── PlatformPills.tsx          # Responsive platform pills
│           └── columns.ts                 # Pool column definitions
│
├── app/(dashboard)/pools/
│   └── page.tsx                           # Main page (uses PoolsTable)
│
└── lib/api/adapter/
    ├── types.ts                           # Add sharingGroups to PoolsResponse
    └── transforms.ts                      # Update transformPoolsResponse
```

---

## Patterns to Preserve

### 1. Column Width Shares System

From `column-config.ts` - **CRITICAL for aligned columns:**

```typescript
/**
 * Column width specification.
 * - number: fixed width in pixels
 * - object: flexible width with min floor and share proportion
 */
type ColumnWidth = number | { min: number; share: number };

// Example column definitions
const columns = [
  { id: "status", width: 24 },                    // Fixed 24px
  { id: "name", width: { min: 150, share: 2.8 }}, // Flexible, gets 2.8x share
  { id: "duration", width: { min: 70, share: 0.8 }},
];

/**
 * Generate CSS grid template from column definitions.
 * Respects user overrides for manual column resizing.
 */
function getGridTemplate(
  columns: ColumnDef[],
  userWidths: ColumnUserWidths = {},
): string {
  return columns
    .map((col) => {
      const user = userWidths[col.id];
      
      // User override exists
      if (user) {
        if (user.mode === 'fixed') return `${user.value}px`;
        // min mode: user value as floor, share preserved
        const share = typeof col.width === 'number' ? 0 : col.width.share;
        return `minmax(${user.value}px, ${share}fr)`;
      }
      
      // No override: use config
      if (typeof col.width === "number") return `${col.width}px`;
      return `minmax(${col.width.min}px, ${col.width.share}fr)`;
    })
    .join(" ");
}

// Result: "24px minmax(150px, 2.8fr) 300px minmax(70px, 0.8fr)"
//                                    ↑ User resized to fixed 300px
```

### 2. DND Column Reordering

From `TaskTable.tsx` - horizontal-only drag:

```typescript
import { DndContext, closestCenter, PointerSensor, KeyboardSensor, useSensor, useSensors } from "@dnd-kit/core";
import { SortableContext, horizontalListSortingStrategy, useSortable, arrayMove } from "@dnd-kit/sortable";

// Horizontal-only modifier - locks Y axis completely
const restrictToHorizontalAxis = ({ transform }) => ({
  ...transform,
  y: 0,
  scaleX: 1,
  scaleY: 1,
});

// In header component
const sensors = useSensors(
  useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
);

const handleDragEnd = (event: DragEndEvent) => {
  const { active, over } = event;
  if (over && active.id !== over.id) {
    const oldIndex = columnOrder.indexOf(active.id as string);
    const newIndex = columnOrder.indexOf(over.id as string);
    setColumnOrder(arrayMove(columnOrder, oldIndex, newIndex));
  }
};

<DndContext 
  sensors={sensors} 
  collisionDetection={closestCenter} 
  onDragEnd={handleDragEnd} 
  modifiers={[restrictToHorizontalAxis]} 
  autoScroll={false}
>
  <SortableContext items={optionalColumnIds} strategy={horizontalListSortingStrategy}>
    {/* Sortable header cells */}
  </SortableContext>
</DndContext>
```

### 3. Virtualization

From `TaskTable.tsx`:

```typescript
import { useVirtualizerCompat } from "@/lib/hooks";

const scrollRef = useRef<HTMLDivElement>(null);
const virtualizer = useVirtualizerCompat({
  count: rows.length,
  getScrollElement: () => scrollRef.current,
  estimateSize: () => compactMode ? 32 : 48,  // Row height based on mode
  overscan: 15,
});

const virtualItems = virtualizer.getVirtualItems();
const totalSize = virtualizer.getTotalSize();

<div ref={scrollRef} className="flex-1 overflow-auto">
  <div style={{ height: totalSize, position: "relative" }}>
    {virtualItems.map((virtualRow) => {
      const row = rows[virtualRow.index];
      return (
        <div
          key={row.id}
          className="absolute left-0 top-0 w-full"
          style={{
            height: compactMode ? 32 : 48,
            transform: `translateY(${virtualRow.start}px)`,
          }}
        >
          <PoolRow pool={row} />
        </div>
      );
    })}
  </div>
</div>
```

### 4. Smart Search with Chips

From `SmartSearch.tsx` - **key patterns:**

```typescript
interface SearchChip {
  field: string;   // e.g., "status", "platform", "name"
  value: string;   // e.g., "ONLINE", "linux-arm64"
  label: string;   // Display text: "status:ONLINE"
}

interface SearchField {
  id: string;
  label: string;
  prefix: string;  // e.g., "status:", "platform:", "" for name
  getValues: (data: Pool[]) => string[];  // Autocomplete suggestions
  match: (pool: Pool, value: string) => boolean;  // Filter logic
}

// Pool-specific search fields
const POOL_SEARCH_FIELDS: SearchField[] = [
  {
    id: "name",
    label: "Name",
    prefix: "",
    getValues: (pools) => pools.map(p => p.name).slice(0, 10),
    match: (pool, value) => pool.name.toLowerCase().includes(value.toLowerCase()),
  },
  {
    id: "status",
    label: "Status",
    prefix: "status:",
    getValues: () => ["ONLINE", "MAINTENANCE", "OFFLINE"],
    match: (pool, value) => pool.status.toLowerCase() === value.toLowerCase(),
  },
  {
    id: "platform",
    label: "Platform",
    prefix: "platform:",
    getValues: (pools) => [...new Set(pools.flatMap(p => p.platforms))],
    match: (pool, value) => pool.platforms.some(p => 
      p.toLowerCase().includes(value.toLowerCase())
    ),
  },
  {
    id: "backend",
    label: "Backend",
    prefix: "backend:",
    getValues: (pools) => [...new Set(pools.map(p => p.backend))],
    match: (pool, value) => pool.backend.toLowerCase() === value.toLowerCase(),
  },
];

// Filter logic: same-field = OR, different-field = AND
function filterByChips(pools: Pool[], chips: SearchChip[]): Pool[] {
  if (chips.length === 0) return pools;
  
  // Group chips by field
  const chipGroups = new Map<string, string[]>();
  for (const chip of chips) {
    const values = chipGroups.get(chip.field) ?? [];
    values.push(chip.value);
    chipGroups.set(chip.field, values);
  }
  
  return pools.filter(pool => {
    // AND across different fields
    for (const [fieldId, values] of chipGroups) {
      const field = POOL_SEARCH_FIELDS.find(f => f.id === fieldId);
      if (!field) continue;
      // OR within same field
      if (!values.some(v => field.match(pool, v))) return false;
    }
    return true;
  });
}
```

### 5. Zustand Store with Persistence

**Complete store for pools page:**

```typescript
// File: src/components/features/pools/PoolsTableStore.ts

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { SortingState, VisibilityState } from '@tanstack/react-table';

interface ColumnUserWidth {
  value: number;
  mode: 'min' | 'fixed';
}

interface SearchChip {
  field: string;
  value: string;
  label: string;
}

interface PoolsTableState {
  // TanStack-compatible state
  sorting: SortingState;
  columnVisibility: VisibilityState;
  columnOrder: string[];
  
  // Column resizing
  columnUserWidths: Record<string, ColumnUserWidth>;
  
  // Panel
  panelPct: number;
  selectedPoolName: string | null;
  
  // Custom state
  globalFilterChips: SearchChip[];
  displayMode: 'used' | 'free';
  compactMode: boolean;
  collapsedSections: string[];
}

interface PoolsTableActions {
  // TanStack actions
  setSorting: (sorting: SortingState) => void;
  setColumnVisibility: (visibility: VisibilityState) => void;
  setColumnOrder: (order: string[]) => void;
  
  // Column resizing
  setColumnWidth: (columnId: string, width: ColumnUserWidth) => void;
  resetColumnWidth: (columnId: string) => void;
  resetAllColumnWidths: () => void;
  
  // Panel
  setPanelPct: (pct: number) => void;
  setSelectedPool: (name: string | null) => void;
  
  // Filters
  addFilterChip: (chip: SearchChip) => void;
  removeFilterChip: (index: number) => void;
  clearFilterChips: () => void;
  
  // Display
  toggleDisplayMode: () => void;
  toggleCompactMode: () => void;
  toggleSection: (status: string) => void;
}

export const usePoolsTableStore = create<PoolsTableState & PoolsTableActions>()(
  persist(
    (set) => ({
      // Initial state
      sorting: [],
      columnVisibility: { description: true, backend: false },
      columnOrder: ['pool', 'description', 'quota', 'capacity', 'platforms', 'backend'],
      columnUserWidths: {},
      panelPct: 50,
      selectedPoolName: null,
      globalFilterChips: [],
      displayMode: 'free',
      compactMode: false,
      collapsedSections: [],
      
      // TanStack actions
      setSorting: (sorting) => set({ sorting }),
      setColumnVisibility: (columnVisibility) => set({ columnVisibility }),
      setColumnOrder: (columnOrder) => set({ columnOrder }),
      
      // Column resizing
      setColumnWidth: (columnId, width) => set((s) => ({
        columnUserWidths: { ...s.columnUserWidths, [columnId]: width },
      })),
      resetColumnWidth: (columnId) => set((s) => {
        const next = { ...s.columnUserWidths };
        delete next[columnId];
        return { columnUserWidths: next };
      }),
      resetAllColumnWidths: () => set({ columnUserWidths: {} }),
      
      // Panel
      setPanelPct: (panelPct) => set({ panelPct }),
      setSelectedPool: (selectedPoolName) => set({ selectedPoolName }),
      
      // Filters
      addFilterChip: (chip) => set((s) => ({ 
        globalFilterChips: [...s.globalFilterChips, chip] 
      })),
      removeFilterChip: (index) => set((s) => ({ 
        globalFilterChips: s.globalFilterChips.filter((_, i) => i !== index) 
      })),
      clearFilterChips: () => set({ globalFilterChips: [] }),
      
      // Display
      toggleDisplayMode: () => set((s) => ({ 
        displayMode: s.displayMode === 'free' ? 'used' : 'free' 
      })),
      toggleCompactMode: () => set((s) => ({ compactMode: !s.compactMode })),
      toggleSection: (status) => set((s) => ({
        collapsedSections: s.collapsedSections.includes(status)
          ? s.collapsedSections.filter(st => st !== status)
          : [...s.collapsedSections, status]
      })),
    }),
    {
      name: 'pools-table-settings',
      partialize: (state) => ({
        // Persist these (not runtime state like selectedPoolName, globalFilterChips)
        sorting: state.sorting,
        columnVisibility: state.columnVisibility,
        columnOrder: state.columnOrder,
        columnUserWidths: state.columnUserWidths,
        panelPct: state.panelPct,
        displayMode: state.displayMode,
        compactMode: state.compactMode,
        collapsedSections: state.collapsedSections,
      }),
    }
  )
);
```

### 6. TanStack Table Integration

```typescript
// File: src/components/features/pools/PoolsTable.tsx

import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  flexRender,
  type ColumnDef,
} from '@tanstack/react-table';
import { usePoolsTableStore } from './PoolsTableStore';

export function PoolsTable({ pools, sharingGroups }: Props) {
  const {
    sorting, setSorting,
    columnVisibility, setColumnVisibility,
    columnOrder,
    columnUserWidths, setColumnWidth, resetColumnWidth,
    globalFilterChips,
    displayMode,
    compactMode,
    collapsedSections,
    selectedPoolName, setSelectedPool,
  } = usePoolsTableStore();

  // Pre-filter by chips (our smart search)
  const filteredPools = useMemo(() => 
    filterByChips(pools, globalFilterChips),
    [pools, globalFilterChips]
  );

  // TanStack table instance
  const table = useReactTable({
    data: filteredPools,
    columns: poolColumns,
    state: {
      sorting,
      columnVisibility,
      columnOrder,
    },
    onSortingChange: setSorting,
    onColumnVisibilityChange: setColumnVisibility,
    onColumnOrderChange: setColumnOrder,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    enableMultiSort: true,
    enableColumnResizing: true,
    columnResizeMode: 'onChange',
  });

  // Build grid template with user widths
  const gridTemplate = useMemo(() => 
    buildGridTemplate(poolColumns, columnUserWidths),
    [columnUserWidths]
  );

  // Get sorted rows, then group by status
  const sortedRows = table.getRowModel().rows;
  
  // ... render with custom JSX using your patterns
}
```

---

## Generic Components & Reusability

**CRITICAL:** Although this is the pools page redesign, all foundational components MUST be built as generic, reusable primitives. The pools page is just the first consumer.

### Component Location Strategy

```
src/
├── components/
│   ├── ui/                          # Generic UI primitives (shadcn pattern)
│   │   ├── data-table/              # NEW: Generic data table system
│   │   │   ├── index.ts
│   │   │   ├── DataTable.tsx        # Main table component
│   │   │   ├── DataTableHeader.tsx  # Header with DND columns
│   │   │   ├── DataTableRow.tsx     # Virtualized row
│   │   │   ├── ColumnResizeHandle.tsx
│   │   │   ├── types.ts             # Column definitions, etc.
│   │   │   └── use-data-table.ts    # Table logic hook
│   │   │
│   │   ├── smart-search/            # NEW: Generic smart search
│   │   │   ├── index.ts
│   │   │   ├── SmartSearch.tsx      # Main component
│   │   │   ├── SearchChip.tsx       # Individual chip
│   │   │   ├── types.ts             # SearchField, SearchChip types
│   │   │   └── use-smart-search.ts  # Search logic hook
│   │   │
│   │   ├── resizable-panel/         # NEW: Generic resizable panel
│   │   │   ├── index.ts
│   │   │   ├── ResizablePanel.tsx   # Panel with resize handle
│   │   │   ├── PanelHeader.tsx      # Header with kebab menu
│   │   │   └── use-resizable-panel.ts
│   │   │
│   │   └── ... (existing shadcn components)
│   │
│   └── features/
│       └── pools/                   # Pools-SPECIFIC components
│           ├── PoolsTable.tsx       # Uses DataTable with pool columns
│           ├── PoolRow.tsx          # Pool-specific row rendering
│           ├── PoolPanel.tsx        # Uses ResizablePanel
│           ├── pool-columns.ts      # Pool-specific column config
│           └── pool-search-fields.ts # Pool-specific search fields
```

### Generic SmartSearch

```tsx
// src/components/ui/smart-search/types.ts
export interface SearchField<T> {
  /** Unique identifier */
  id: string;
  /** Display label */
  label: string;
  /** Prefix for typed queries (e.g., "status:" "name:") */
  prefix: string;
  /** Extract autocomplete values from data */
  getValues: (data: T[]) => string[];
  /** Check if item matches this field's value */
  match: (item: T, value: string) => boolean;
}

export interface SearchChip {
  field: string;
  value: string;
  label: string;
}

export interface SmartSearchProps<T> {
  /** Data to search through */
  data: T[];
  /** Field definitions for this search */
  fields: SearchField<T>[];
  /** Current chips */
  chips: SearchChip[];
  /** Callback when chips change */
  onChipsChange: (chips: SearchChip[]) => void;
  /** Placeholder text */
  placeholder?: string;
  /** Enable natural language date parsing (requires chrono-node) */
  enableDateParsing?: boolean;
}

// src/components/ui/smart-search/SmartSearch.tsx
export function SmartSearch<T>({
  data,
  fields,
  chips,
  onChipsChange,
  placeholder = "Search...",
  enableDateParsing = false,
}: SmartSearchProps<T>) {
  // Generic implementation here...
}
```

**Usage in Pools:**

```tsx
// src/components/features/pools/pool-search-fields.ts
import type { SearchField } from "@/components/ui/smart-search";
import type { Pool } from "@/lib/api/adapter";

export const POOL_SEARCH_FIELDS: SearchField<Pool>[] = [
  {
    id: "name",
    label: "Pool Name",
    prefix: "name:",
    getValues: (pools) => pools.map(p => p.name),
    match: (pool, value) => pool.name.toLowerCase().includes(value.toLowerCase()),
  },
  {
    id: "status",
    label: "Status",
    prefix: "status:",
    getValues: () => ["online", "maintenance", "offline"],
    match: (pool, value) => pool.status.toLowerCase() === value.toLowerCase(),
  },
  {
    id: "platform",
    label: "Platform",
    prefix: "platform:",
    getValues: (pools) => [...new Set(pools.flatMap(p => p.platforms))],
    match: (pool, value) => pool.platforms.some(p => p.toLowerCase().includes(value.toLowerCase())),
  },
];

// In PoolsTable.tsx
import { SmartSearch } from "@/components/ui/smart-search";
import { POOL_SEARCH_FIELDS } from "./pool-search-fields";

<SmartSearch
  data={pools}
  fields={POOL_SEARCH_FIELDS}
  chips={searchChips}
  onChipsChange={setSearchChips}
  placeholder="Search pools... (try 'status:online' or 'platform:dgx')"
/>
```

**Usage in Resources (future):**

```tsx
// src/components/features/resources/resource-search-fields.ts
export const RESOURCE_SEARCH_FIELDS: SearchField<Resource>[] = [
  {
    id: "name",
    label: "Resource Name",
    prefix: "name:",
    getValues: (resources) => resources.map(r => r.name),
    match: (resource, value) => resource.name.toLowerCase().includes(value.toLowerCase()),
  },
  {
    id: "pool",
    label: "Pool",
    prefix: "pool:",
    getValues: (resources) => [...new Set(resources.flatMap(r => r.poolMemberships.map(m => m.pool)))],
    match: (resource, value) => resource.poolMemberships.some(m => m.pool.toLowerCase().includes(value.toLowerCase())),
  },
  // ... more fields
];
```

### Generic DataTable

```tsx
// src/components/ui/data-table/types.ts
export interface ColumnDef<T> {
  id: string;
  /** Header label */
  label: string;
  /** Menu label (for show/hide dropdown) */
  menuLabel?: string;
  /** Width specification */
  width: { min: number; share: number } | number;
  /** Alignment */
  align?: "left" | "right" | "center";
  /** Is this column sortable? */
  sortable?: boolean;
  /** Is this column mandatory (can't be hidden)? */
  mandatory?: boolean;
  /** Render function for cell content */
  render: (item: T, index: number) => React.ReactNode;
  /** Optional: custom sort function */
  sort?: (a: T, b: T) => number;
  /** Optional: get sortable value */
  getSortValue?: (item: T) => string | number;
}

export interface DataTableProps<T> {
  /** Data to display */
  data: T[];
  /** Column definitions */
  columns: ColumnDef<T>[];
  /** Currently visible column IDs */
  visibleColumns: string[];
  /** Column order */
  columnOrder: string[];
  /** Sort state */
  sort: { column: string; direction: "asc" | "desc" } | null;
  /** Callbacks */
  onSort: (column: string) => void;
  onColumnOrderChange: (order: string[]) => void;
  onColumnVisibilityChange: (visible: string[]) => void;
  /** Row click handler */
  onRowClick?: (item: T, index: number) => void;
  /** Selected item (for highlighting) */
  selectedItem?: T | null;
  /** Get unique key for item */
  getRowKey: (item: T) => string;
  /** Optional: group by function for sections */
  groupBy?: (item: T) => { id: string; label: string; icon?: string };
  /** Optional: compact mode */
  compact?: boolean;
  /** Optional: virtualization config */
  virtualize?: boolean | { estimateSize: number };
}

// src/components/ui/data-table/DataTable.tsx
export function DataTable<T>({
  data,
  columns,
  visibleColumns,
  columnOrder,
  sort,
  onSort,
  onColumnOrderChange,
  onColumnVisibilityChange,
  onRowClick,
  selectedItem,
  getRowKey,
  groupBy,
  compact = false,
  virtualize = true,
}: DataTableProps<T>) {
  // Generic implementation using:
  // - TanStack Table for logic
  // - @dnd-kit for column reordering
  // - @tanstack/react-virtual for virtualization
  // - CSS grid with minmax for column widths
}
```

**Usage in Pools:**

```tsx
// src/components/features/pools/pool-columns.ts
import type { ColumnDef } from "@/components/ui/data-table";
import type { Pool } from "@/lib/api/adapter";
import { GpuProgressCell } from "./GpuProgressCell";
import { PlatformPills } from "./PlatformPills";

export const POOL_COLUMNS: ColumnDef<Pool>[] = [
  {
    id: "name",
    label: "Pool",
    menuLabel: "Pool Name",
    width: { min: 180, share: 2 },
    mandatory: true,
    sortable: true,
    render: (pool) => (
      <div className="flex items-center gap-2">
        <StatusDot status={pool.status} />
        <span className="font-medium truncate">{pool.name}</span>
      </div>
    ),
    getSortValue: (pool) => pool.name,
  },
  {
    id: "quota",
    label: "Quota",
    menuLabel: "GPU Quota",
    width: { min: 120, share: 1 },
    sortable: true,
    render: (pool) => <GpuProgressCell value={pool.quota} type="quota" />,
    getSortValue: (pool) => pool.quota.used,
  },
  // ... more columns
];

// In PoolsTable.tsx
import { DataTable } from "@/components/ui/data-table";
import { POOL_COLUMNS } from "./pool-columns";

<DataTable
  data={filteredPools}
  columns={POOL_COLUMNS}
  visibleColumns={store.visibleColumnIds}
  columnOrder={store.columnOrder}
  sort={store.sort}
  onSort={store.setSort}
  onColumnOrderChange={store.setColumnOrder}
  onColumnVisibilityChange={store.setVisibleColumns}
  onRowClick={handleSelectPool}
  selectedItem={selectedPool}
  getRowKey={(pool) => pool.name}
  groupBy={(pool) => ({
    id: pool.status,
    label: STATUS_LABELS[pool.status],
    icon: STATUS_ICONS[pool.status],
  })}
  compact={store.compactMode}
/>
```

### Generic Store Factory

```tsx
// src/lib/stores/create-table-store.ts
import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface TableStoreState {
  visibleColumnIds: string[];
  columnOrder: string[];
  sort: { column: string; direction: "asc" | "desc" } | null;
  compactMode: boolean;
  collapsedSections: string[];
  panelWidth: number;
  columnUserWidths: Record<string, { value: number; mode: "min" | "fixed" }>;
}

export interface TableStoreActions {
  setVisibleColumns: (ids: string[]) => void;
  toggleColumn: (id: string) => void;
  setColumnOrder: (order: string[]) => void;
  setSort: (column: string) => void;
  toggleCompactMode: () => void;
  toggleSection: (id: string) => void;
  setPanelWidth: (width: number) => void;
  setColumnWidth: (id: string, value: number, mode: "min" | "fixed") => void;
  resetColumnWidth: (id: string) => void;
  reset: () => void;
}

export type TableStore = TableStoreState & TableStoreActions;

interface CreateTableStoreOptions {
  /** Storage key for persistence */
  storageKey: string;
  /** Default visible columns */
  defaultVisibleColumns: string[];
  /** Default column order */
  defaultColumnOrder: string[];
  /** Default sort */
  defaultSort?: { column: string; direction: "asc" | "desc" } | null;
}

export function createTableStore(options: CreateTableStoreOptions) {
  const defaultState: TableStoreState = {
    visibleColumnIds: options.defaultVisibleColumns,
    columnOrder: options.defaultColumnOrder,
    sort: options.defaultSort ?? null,
    compactMode: false,
    collapsedSections: [],
    panelWidth: 40,
    columnUserWidths: {},
  };

  return create<TableStore>()(
    persist(
      (set, get) => ({
        ...defaultState,
        
        setVisibleColumns: (ids) => set({ visibleColumnIds: ids }),
        toggleColumn: (id) => set((state) => ({
          visibleColumnIds: state.visibleColumnIds.includes(id)
            ? state.visibleColumnIds.filter(c => c !== id)
            : [...state.visibleColumnIds, id],
        })),
        setColumnOrder: (order) => set({ columnOrder: order }),
        setSort: (column) => set((state) => ({
          sort: state.sort?.column === column
            ? { column, direction: state.sort.direction === "asc" ? "desc" : "asc" }
            : { column, direction: "asc" },
        })),
        toggleCompactMode: () => set((state) => ({ compactMode: !state.compactMode })),
        toggleSection: (id) => set((state) => ({
          collapsedSections: state.collapsedSections.includes(id)
            ? state.collapsedSections.filter(s => s !== id)
            : [...state.collapsedSections, id],
        })),
        setPanelWidth: (width) => set({ panelWidth: width }),
        setColumnWidth: (id, value, mode) => set((state) => ({
          columnUserWidths: { ...state.columnUserWidths, [id]: { value, mode } },
        })),
        resetColumnWidth: (id) => set((state) => {
          const { [id]: _, ...rest } = state.columnUserWidths;
          return { columnUserWidths: rest };
        }),
        reset: () => set(defaultState),
      }),
      {
        name: options.storageKey,
        version: 1,
      }
    )
  );
}
```

**Usage:**

```tsx
// src/components/features/pools/pools-table-store.ts
import { createTableStore } from "@/lib/stores/create-table-store";

export const usePoolsTableStore = createTableStore({
  storageKey: "pools-table-settings",
  defaultVisibleColumns: ["name", "quota", "capacity", "platforms", "backend"],
  defaultColumnOrder: ["name", "quota", "capacity", "platforms", "backend"],
  defaultSort: { column: "name", direction: "asc" },
});

// src/components/features/resources/resources-table-store.ts (future)
import { createTableStore } from "@/lib/stores/create-table-store";

export const useResourcesTableStore = createTableStore({
  storageKey: "resources-table-settings",
  defaultVisibleColumns: ["name", "pool", "gpu", "cpu", "memory", "storage"],
  defaultColumnOrder: ["name", "pool", "gpu", "cpu", "memory", "storage"],
  defaultSort: { column: "name", direction: "asc" },
});
```

### Generic ResizablePanel

```tsx
// src/components/ui/resizable-panel/types.ts
export interface ResizablePanelProps {
  /** Current width percentage */
  widthPct: number;
  /** Width change callback */
  onWidthChange: (pct: number) => void;
  /** Panel content */
  children: React.ReactNode;
  /** Optional header */
  header?: React.ReactNode;
  /** Close callback */
  onClose?: () => void;
  /** Minimum width percentage */
  minPct?: number;
  /** Maximum width percentage */
  maxPct?: number;
  /** Width presets for snap menu */
  widthPresets?: number[];
  /** Position */
  position?: "left" | "right";
}

// src/components/ui/resizable-panel/ResizablePanel.tsx
export function ResizablePanel({
  widthPct,
  onWidthChange,
  children,
  header,
  onClose,
  minPct = 20,
  maxPct = 80,
  widthPresets = [33, 50, 66],
  position = "right",
}: ResizablePanelProps) {
  // Generic implementation with:
  // - Drag handle
  // - RAF-throttled resize
  // - Snap presets
}
```

### Reusability Checklist

For every component built:

| Question | If No, Refactor |
|----------|-----------------|
| Can this be used on the Resources page? | Extract to `ui/` |
| Can this be used on the Workflows page? | Extract to `ui/` |
| Does it have pools-specific logic? | Move logic to feature/, keep UI generic |
| Does it import from `features/pools/`? | That's fine for feature components, not for `ui/` |
| Can external teams use this with custom themes? | Should be in `ui/` |

### Implementation Order

1. **Generic primitives first** (`src/components/ui/`)
   - `smart-search/` — Generic search with chips
   - `data-table/` — Generic virtualized table with DND columns
   - `resizable-panel/` — Generic resizable panel
   - `create-table-store` — Store factory

2. **Pools-specific composition** (`src/components/features/pools/`)
   - `pool-columns.ts` — Column definitions
   - `pool-search-fields.ts` — Search field definitions
   - `pools-table-store.ts` — Store instance
   - `PoolsTable.tsx` — Composed table
   - `PoolPanel.tsx` — Composed panel

3. **Future migrations** (same pattern)
   - Resources page → uses same primitives
   - Workflows page → uses same primitives
   - Any new table page → uses same primitives

---

## Codebase Architecture & Patterns

**CRITICAL:** These patterns are established in `src/app/(dashboard)/`, `src/headless/`, and `src/lib/api/adapter/`. Follow them strictly.

### Three-Layer Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              UI COMPONENTS                                   │
│  src/app/(dashboard)/pools/page.tsx                                         │
│  src/components/features/pools/*.tsx                                         │
│                                                                              │
│  ✓ Pure presentation                                                         │
│  ✓ Styling only, no business logic                                           │
│  ✓ Imports from headless for behavior                                        │
│  ✓ Imports from adapter for API types                                        │
└─────────────────────────────────────────────────────────────────────────────┘
                                    ↓
┌─────────────────────────────────────────────────────────────────────────────┐
│                            HEADLESS HOOKS                                    │
│  src/headless/use-pools-list.ts                                              │
│  src/headless/use-pool-detail.ts                                             │
│                                                                              │
│  ✓ Business logic without styling                                            │
│  ✓ Written for IDEAL backend (clean types)                                   │
│  ✓ Imports from adapter (not generated.ts directly)                          │
│  ✓ External teams can use these with custom themes                           │
│  ✓ Memoization, filtering, grouping, state management                        │
└─────────────────────────────────────────────────────────────────────────────┘
                                    ↓
┌─────────────────────────────────────────────────────────────────────────────┐
│                          BACKEND ADAPTER LAYER                               │
│  src/lib/api/adapter/                                                        │
│  ├── types.ts       - Ideal types the UI expects                            │
│  ├── transforms.ts  - Data shape workarounds                                │
│  ├── pagination.ts  - Pagination shim (client-side for now)                 │
│  ├── hooks.ts       - React Query hooks with transformation                  │
│  └── index.ts       - Public exports                                         │
│                                                                              │
│  ✓ ALL backend workarounds quarantined here                                  │
│  ✓ Type casting, number parsing, unit conversion                             │
│  ✓ When backend is fixed, this layer shrinks                                 │
│  ✓ Ultimate goal: remove entirely when backend is ideal                      │
└─────────────────────────────────────────────────────────────────────────────┘
                                    ↓
┌─────────────────────────────────────────────────────────────────────────────┐
│                        GENERATED TYPES (Source of Truth)                     │
│  src/lib/api/generated.ts  (auto-generated from OpenAPI)                     │
│                                                                              │
│  ✓ Run `pnpm generate-api` to regenerate                                     │
│  ✓ Enums used directly (PoolStatus, BackendResourceType)                     │
│  ✓ React Query hooks generated                                               │
│  ✓ DO NOT edit manually                                                      │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Import Rules

```tsx
// ❌ BAD: UI component imports from generated.ts
import { useGetPoolQuotasApiPoolQuotaGet, PoolResourceUsage } from "@/lib/api/generated";

// ✅ GOOD: UI component imports from adapter
import { usePools, type Pool } from "@/lib/api/adapter";

// ✅ GOOD: Enums that backend returns correctly can be imported from generated.ts
import { PoolStatus, BackendResourceType } from "@/lib/api/generated";

// ✅ GOOD: Headless hooks import from adapter, not generated
import { usePools, type Pool } from "@/lib/api/adapter";
```

### Headless Hooks Pattern

```tsx
// src/headless/use-pools-list.ts
/**
 * Headless hook for pools list behavior.
 *
 * Provides all business logic for listing, searching, filtering,
 * and grouping pools - without any styling.
 *
 * Use this hook in your themed component to get consistent behavior
 * while applying your own design.
 */

import { useState, useMemo, useCallback } from "react";
import { usePools, type Pool } from "@/lib/api/adapter";  // ← From adapter!
import { PoolStatus } from "@/lib/api/generated";          // ← Enums OK from generated

export interface UsePoolsListReturn {
  // Data
  allPools: Pool[];
  filteredPools: Pool[];
  groupedPools: PoolGroup[];
  /** Placeholder for future extensions */
  
  // Search behavior
  search: string;
  setSearch: (query: string) => void;
  clearSearch: () => void;
  hasSearch: boolean;
  
  // Collapse behavior
  toggleSection: (status: PoolStatusType) => void;
  isSectionCollapsed: (status: PoolStatusType, count: number) => boolean;
  
  // Query state
  isLoading: boolean;
  error: HTTPValidationError | null;
  refetch: () => void;
}

export function usePoolsList(options: UsePoolsListOptions = {}): UsePoolsListReturn {
  const { pools, isLoading, error, refetch } = usePools();  // ← From adapter
  
  // All business logic here...
  const filteredPools = useMemo(() => { /* ... */ }, [pools, search]);
  const groupedPools = useMemo(() => { /* ... */ }, [filteredPools]);
  
  return { /* ... */ };
}
```

### Backend Adapter Pattern

```tsx
// src/lib/api/adapter/transforms.ts
/**
 * Transform functions that convert backend responses to ideal types.
 *
 * ============================================================================
 * ⚠️  ALL BACKEND WORKAROUNDS ARE QUARANTINED HERE
 * ============================================================================
 *
 * Each transform function documents:
 * - What backend issue it works around
 * - What the ideal backend behavior would be
 * - Link to BACKEND_TODOS.md issue
 *
 * When backend is fixed, these transforms can be simplified or removed.
 */

// WORKAROUND: Backend returns numbers as strings
// Issue: BACKEND_TODOS.md#2
function parseNumber(value: string | number | undefined | null): number {
  if (value === undefined || value === null) return 0;
  if (typeof value === "number") return value;
  const parsed = parseFloat(value);
  return isNaN(parsed) ? 0 : parsed;
}

// WORKAROUND: Memory is in KiB, storage is in bytes
// Issue: BACKEND_TODOS.md#6
const KIB_PER_GIB = 1024 * 1024;
function kibToGiB(kib: number): number {
  return kib === 0 ? 0 : Math.round(kib / KIB_PER_GIB);
}
```

### BACKEND_TODOS Pattern

Document backend issues in `src/lib/api/adapter/BACKEND_TODOS.md`:

```markdown
### Issue #N: [Description]

**Priority:** High/Medium/Low  
**Status:** Active workaround in [file]

[Describe the problem]

**Workaround:**
```typescript
// Code showing the workaround
```

**Ideal behavior:**
```typescript
// What the backend should return
```

**When fixed:**
1. Remove the workaround from [file]
2. Run `pnpm generate-api`
3. Update this document
```

### Adapter Hook Pattern

```tsx
// src/lib/api/adapter/hooks.ts
/**
 * React Query hooks with automatic transformation to ideal types.
 *
 * UI components should use these hooks instead of the generated ones.
 * These hooks:
 * - Call the generated API hooks
 * - Transform responses to ideal types
 * - Return clean, well-typed data
 */

import { useMemo } from "react";
import { useGetPoolQuotasApiPoolQuotaGet } from "../generated";
import { transformPoolsResponse } from "./transforms";

export function usePools() {
  const query = useGetPoolQuotasApiPoolQuotaGet({ all_pools: true });

  const pools = useMemo(() => {
    if (!query.data) return [];
    return transformPoolsResponse(query.data).pools;  // ← Transform here
  }, [query.data]);

  return {
    pools,
    isLoading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
  };
}
```

### File Organization

```
src/
├── app/(dashboard)/
│   ├── pools/
│   │   ├── page.tsx           # Route entry, uses headless + components
│   │   ├── error.tsx          # Error boundary for route
│   │   └── [poolName]/
│   │       └── page.tsx       # Pool detail route
│   └── resources/
│       └── page.tsx
│
├── components/features/pools/
│   ├── index.ts               # Barrel exports
│   ├── PoolsTable.tsx         # Table component (styling)
│   ├── PoolRow.tsx            # Row component (styling)
│   ├── PoolPanel.tsx          # Details panel (styling)
│   └── pool-row.tsx           # Existing row (to be refactored)
│
├── headless/
│   ├── index.ts               # Barrel exports + documentation
│   ├── types.ts               # Shared types for headless hooks
│   ├── use-pools-list.ts      # Pools list behavior
│   ├── use-pool-detail.ts     # Pool detail behavior
│   ├── use-resources.ts       # Resources behavior
│   └── use-display-mode.ts    # Free/Used toggle behavior
│
└── lib/api/
    ├── generated.ts           # Auto-generated from OpenAPI
    ├── fetcher.ts             # Fetch wrapper
    └── adapter/
        ├── index.ts           # Public exports
        ├── types.ts           # Ideal types
        ├── transforms.ts      # Backend → Ideal transforms
        ├── hooks.ts           # Transformed React Query hooks
        ├── pagination.ts      # Pagination shim
        ├── utils.ts           # Helper utilities
        └── BACKEND_TODOS.md   # Backend issues documentation
```

### Key Principles

| Principle | Description |
|-----------|-------------|
| **UI is Pure Presentation** | Components in `app/` and `components/` only do styling, no business logic |
| **Headless for Behavior** | All business logic (filtering, sorting, grouping) lives in `headless/` |
| **Adapter Quarantines Workarounds** | ALL backend quirks are handled in `adapter/`, not scattered across codebase |
| **Generated is Source of Truth** | OpenAPI schema → generated.ts → adapter transforms → headless → UI |
| **Write for Ideal Backend** | Headless hooks assume clean data; adapter makes it clean |
| **Document Issues** | Backend problems documented in BACKEND_TODOS.md with priority and workarounds |
| **Shrink Adapter Over Time** | As backend improves, adapter layer shrinks; ultimate goal is to remove it |

### Layer Isolation: What Belongs Where

**⚠️ CRITICAL: Do NOT cross-contaminate layers. Each layer has ONE responsibility.**

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          UI COMPONENTS                                       │
│  Location: src/app/, src/components/                                         │
├─────────────────────────────────────────────────────────────────────────────┤
│  ✅ ALLOWED:                          │  ❌ FORBIDDEN:                       │
│  • JSX rendering                      │  • API calls                         │
│  • CSS classes, styles                │  • Data transformations              │
│  • Event handlers (onClick, etc)      │  • Business logic                    │
│  • Calling headless hooks             │  • Filtering/sorting logic           │
│  • Consuming context values           │  • Backend workarounds               │
│  • Memoization for render perf        │  • Direct import from generated.ts   │
│  • Animation/transition               │  • Type casting                      │
└─────────────────────────────────────────────────────────────────────────────┘
                                    ↓
┌─────────────────────────────────────────────────────────────────────────────┐
│                          HEADLESS HOOKS                                      │
│  Location: src/headless/                                                     │
├─────────────────────────────────────────────────────────────────────────────┤
│  ✅ ALLOWED:                          │  ❌ FORBIDDEN:                       │
│  • Business logic                     │  • JSX rendering                     │
│  • Filtering, sorting, grouping       │  • CSS classes, styles               │
│  • Computed/derived state             │  • DOM manipulation                  │
│  • Calling adapter hooks              │  • Backend workarounds               │
│  • State management (useState, etc)   │  • Direct import from generated.ts   │
│  • Memoization for data perf          │  • Type casting of API responses     │
│  • Error handling logic               │  • Unit conversions                  │
└─────────────────────────────────────────────────────────────────────────────┘
                                    ↓
┌─────────────────────────────────────────────────────────────────────────────┐
│                          BACKEND ADAPTER                                     │
│  Location: src/lib/api/adapter/                                              │
├─────────────────────────────────────────────────────────────────────────────┤
│  ✅ ALLOWED:                          │  ❌ FORBIDDEN:                       │
│  • Type casting (unknown → typed)     │  • Business logic                    │
│  • Data shape transformations         │  • Filtering, sorting                │
│  • Unit conversions (KiB → GiB)       │  • JSX rendering                     │
│  • Number parsing (string → number)   │  • State management                  │
│  • Default value handling             │  • UI-specific logic                 │
│  • Calling generated hooks            │  • Feature-specific code             │
│  • Documenting backend issues         │  • Page-specific code                │
└─────────────────────────────────────────────────────────────────────────────┘
                                    ↓
┌─────────────────────────────────────────────────────────────────────────────┐
│                          GENERATED TYPES                                     │
│  Location: src/lib/api/generated.ts                                          │
├─────────────────────────────────────────────────────────────────────────────┤
│  ✅ ALLOWED:                          │  ❌ FORBIDDEN:                       │
│  • Auto-generated from OpenAPI        │  • Manual edits                      │
│  • Enums (PoolStatus, etc)            │  • Custom types                      │
│  • React Query hooks                  │  • Business logic                    │
│  • Type definitions                   │  • Workarounds                       │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Anti-Patterns: DO NOT DO THIS

```tsx
// ❌ ANTI-PATTERN 1: Business logic in UI component
function PoolsTable({ pools }) {
  // BAD: Filtering logic belongs in headless hook, not UI
  const onlinePools = pools.filter(p => p.status === "ONLINE");
  const offlinePools = pools.filter(p => p.status === "OFFLINE");
  
  // BAD: Sorting logic belongs in headless hook
  const sortedPools = [...pools].sort((a, b) => a.name.localeCompare(b.name));
  
  return <table>...</table>;
}

// ✅ CORRECT: UI consumes pre-computed data from headless hook
function PoolsTable() {
  const { groupedPools, sortedPools } = usePoolsList();
  return <table>...</table>;
}
```

```tsx
// ❌ ANTI-PATTERN 2: Backend workaround in headless hook
function usePoolsList() {
  const query = useGetPoolQuotasApiPoolQuotaGet();
  
  // BAD: Type casting belongs in adapter, not headless
  const response = query.data as PoolResponse;
  
  // BAD: Number parsing belongs in adapter, not headless
  const pools = response.node_sets.flatMap(ns => 
    ns.pools.map(p => ({
      ...p,
      quota: parseInt(p.resource_usage.quota_used), // BAD!
    }))
  );
}

// ✅ CORRECT: Headless receives clean data from adapter
function usePoolsList() {
  const { pools } = usePools(); // From adapter - already clean!
  // pools is Pool[] with proper types, no transformation needed
}
```

```tsx
// ❌ ANTI-PATTERN 3: UI imports from generated.ts
import { useGetPoolQuotasApiPoolQuotaGet, PoolResourceUsage } from "@/lib/api/generated";

function PoolsPage() {
  // BAD: Direct API call in UI
  const query = useGetPoolQuotasApiPoolQuotaGet();
  // BAD: Type from generated in UI
  const pool: PoolResourceUsage = query.data?.node_sets[0]?.pools[0];
}

// ✅ CORRECT: UI imports from adapter
import { type Pool } from "@/lib/api/adapter";
import { usePoolsList } from "@/headless";

function PoolsPage() {
  const { pools } = usePoolsList(); // Clean, typed Pool[]
}
```

```tsx
// ❌ ANTI-PATTERN 4: Adapter contains business logic
// adapter/hooks.ts
export function usePools() {
  const query = useGetPoolQuotasApiPoolQuotaGet();
  
  // BAD: Filtering is business logic, belongs in headless
  const onlinePools = pools.filter(p => p.status === PoolStatus.ONLINE);
  
  // BAD: Sorting is business logic, belongs in headless
  return pools.sort((a, b) => a.name.localeCompare(b.name));
}

// ✅ CORRECT: Adapter only transforms data shape
export function usePools() {
  const query = useGetPoolQuotasApiPoolQuotaGet();
  const pools = useMemo(() => {
    if (!query.data) return [];
    return transformPoolsResponse(query.data).pools; // Just shape transform
  }, [query.data]);
  return { pools, isLoading: query.isLoading };
}
```

```tsx
// ❌ ANTI-PATTERN 5: Headless contains UI logic
// headless/use-pools-list.ts
export function usePoolsList() {
  const { pools } = usePools();
  
  // BAD: CSS class computation belongs in UI
  const getPoolClassName = (pool) => 
    pool.status === "ONLINE" ? "bg-green-100" : "bg-red-100";
  
  // BAD: Icon selection belongs in UI
  const getPoolIcon = (pool) => 
    pool.status === "ONLINE" ? <CheckCircle /> : <XCircle />;
  
  return { pools, getPoolClassName, getPoolIcon }; // BAD!
}

// ✅ CORRECT: Headless provides data, UI decides presentation
export function usePoolsList() {
  const { pools } = usePools();
  const groupedPools = useMemo(() => groupByStatus(pools), [pools]);
  return { pools, groupedPools }; // Just data, no UI concerns
}
```

### Layer Crossing Checklist

Before committing code, verify:

| Question | If Yes, Wrong Layer |
|----------|---------------------|
| Does my UI component have `.filter()` or `.sort()`? | Move to headless |
| Does my UI component have `useMemo` computing derived data? | Move to headless |
| Does my headless hook have `className` or JSX? | Move to UI |
| Does my headless hook import from `generated.ts`? | Import from adapter |
| Does my adapter hook have `.filter()` or business conditions? | Move to headless |
| Does my adapter hook return different data based on use case? | Split into headless |
| Does my adapter have `useState` or `useCallback`? | Likely belongs in headless |

### Extending the Pools Headless Hook

For the redesign, extend the existing hook or create a new one:

```tsx
// src/headless/use-pools-table.ts
/**
 * Headless hook for pools TABLE behavior.
 *
 * Extends use-pools-list with:
 * - TanStack Table integration
 * - Column visibility/ordering
 * - Smart search with chips
 * - Zustand persistence
 */

import { useMemo } from "react";
import { useReactTable, getCoreRowModel, getSortedRowModel } from "@tanstack/react-table";
import { usePools, type Pool } from "@/lib/api/adapter";
import { usePoolsTableStore } from "./stores/pools-table-store";

export function usePoolsTable() {
  const { pools, isLoading, error, refetch } = usePools();
  const { columnVisibility, columnOrder, sort } = usePoolsTableStore();
  
  // TanStack Table instance
  const table = useReactTable({
    data: pools,
    columns: POOL_COLUMNS,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    state: {
      columnVisibility,
      columnOrder,
      sorting: sort ? [{ id: sort.column, desc: sort.direction === "desc" }] : [],
    },
  });
  
  return {
    table,
    pools,
    isLoading,
    error,
    refetch,
    // ... additional state
  };
}
```

---

## Zustand Store Best Practices

**Reference:** [Zustand Documentation](https://zustand.docs.pmnd.rs/)

### Store Organization

```
src/
├── lib/
│   └── stores/
│       ├── index.ts                    # Barrel exports
│       ├── create-table-store.ts       # Generic factory
│       └── types.ts                    # Shared store types
│
└── components/
    └── features/
        └── pools/
            └── stores/
                └── pools-table-store.ts  # Feature-specific store instance
```

### Store Location Rules

| Store Type | Location | Example |
|------------|----------|---------|
| Generic/Reusable factories | `src/lib/stores/` | `create-table-store.ts` |
| Feature-specific instances | `src/components/features/{feature}/stores/` | `pools-table-store.ts` |
| Global app state | `src/lib/stores/` | `app-store.ts` |
| Page-level ephemeral state | Use `useState` instead | — |

### Pattern 1: Store Factory (Recommended for Tables)

```tsx
// src/lib/stores/create-table-store.ts
import { create, type StateCreator } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";

// ============================================================================
// Types
// ============================================================================

export interface TableState {
  // Column state
  visibleColumnIds: string[];
  columnOrder: string[];
  columnUserWidths: Record<string, { value: number; mode: "min" | "fixed" }>;
  
  // Sort state
  sort: { column: string; direction: "asc" | "desc" } | null;
  
  // UI state
  compactMode: boolean;
  collapsedSections: string[];
  panelWidth: number;
  
  // Search state (ephemeral - not persisted)
  searchChips: Array<{ field: string; value: string; label: string }>;
}

export interface TableActions {
  // Column actions
  setVisibleColumns: (ids: string[]) => void;
  toggleColumn: (id: string) => void;
  setColumnOrder: (order: string[]) => void;
  setColumnWidth: (id: string, value: number, mode: "min" | "fixed") => void;
  resetColumnWidth: (id: string) => void;
  
  // Sort actions
  setSort: (column: string) => void;
  clearSort: () => void;
  
  // UI actions
  toggleCompactMode: () => void;
  toggleSection: (id: string) => void;
  setPanelWidth: (width: number) => void;
  
  // Search actions
  setSearchChips: (chips: TableState["searchChips"]) => void;
  addSearchChip: (chip: TableState["searchChips"][0]) => void;
  removeSearchChip: (index: number) => void;
  clearSearch: () => void;
  
  // Reset
  reset: () => void;
}

export type TableStore = TableState & TableActions;

// ============================================================================
// Factory
// ============================================================================

export interface CreateTableStoreOptions {
  /** Unique storage key for localStorage */
  storageKey: string;
  /** Default visible column IDs */
  defaultVisibleColumns: string[];
  /** Default column order */
  defaultColumnOrder: string[];
  /** Default sort (optional) */
  defaultSort?: TableState["sort"];
  /** Default panel width percentage */
  defaultPanelWidth?: number;
}

export function createTableStore(options: CreateTableStoreOptions) {
  const {
    storageKey,
    defaultVisibleColumns,
    defaultColumnOrder,
    defaultSort = null,
    defaultPanelWidth = 40,
  } = options;

  // Initial state (what gets persisted)
  const initialState: TableState = {
    visibleColumnIds: defaultVisibleColumns,
    columnOrder: defaultColumnOrder,
    columnUserWidths: {},
    sort: defaultSort,
    compactMode: false,
    collapsedSections: [],
    panelWidth: defaultPanelWidth,
    searchChips: [], // Ephemeral - not persisted
  };

  // State creator with immer for immutable updates
  const stateCreator: StateCreator<
    TableStore,
    [["zustand/immer", never], ["zustand/persist", unknown]]
  > = (set) => ({
    ...initialState,

    // Column actions
    setVisibleColumns: (ids) =>
      set((state) => {
        state.visibleColumnIds = ids;
      }),

    toggleColumn: (id) =>
      set((state) => {
        const idx = state.visibleColumnIds.indexOf(id);
        if (idx === -1) {
          state.visibleColumnIds.push(id);
        } else {
          state.visibleColumnIds.splice(idx, 1);
        }
      }),

    setColumnOrder: (order) =>
      set((state) => {
        state.columnOrder = order;
      }),

    setColumnWidth: (id, value, mode) =>
      set((state) => {
        state.columnUserWidths[id] = { value, mode };
      }),

    resetColumnWidth: (id) =>
      set((state) => {
        delete state.columnUserWidths[id];
      }),

    // Sort actions
    setSort: (column) =>
      set((state) => {
        if (state.sort?.column === column) {
          // Toggle direction
          state.sort.direction = state.sort.direction === "asc" ? "desc" : "asc";
        } else {
          state.sort = { column, direction: "asc" };
        }
      }),

    clearSort: () =>
      set((state) => {
        state.sort = null;
      }),

    // UI actions
    toggleCompactMode: () =>
      set((state) => {
        state.compactMode = !state.compactMode;
      }),

    toggleSection: (id) =>
      set((state) => {
        const idx = state.collapsedSections.indexOf(id);
        if (idx === -1) {
          state.collapsedSections.push(id);
        } else {
          state.collapsedSections.splice(idx, 1);
        }
      }),

    setPanelWidth: (width) =>
      set((state) => {
        state.panelWidth = width;
      }),

    // Search actions (ephemeral)
    setSearchChips: (chips) =>
      set((state) => {
        state.searchChips = chips;
      }),

    addSearchChip: (chip) =>
      set((state) => {
        state.searchChips.push(chip);
      }),

    removeSearchChip: (index) =>
      set((state) => {
        state.searchChips.splice(index, 1);
      }),

    clearSearch: () =>
      set((state) => {
        state.searchChips = [];
      }),

    // Reset
    reset: () => set(initialState),
  });

  // Create store with middleware
  return create<TableStore>()(
    persist(
      immer(stateCreator),
      {
        name: storageKey,
        version: 1,
        storage: createJSONStorage(() => localStorage),
        // Only persist these fields (exclude ephemeral state)
        partialize: (state) => ({
          visibleColumnIds: state.visibleColumnIds,
          columnOrder: state.columnOrder,
          columnUserWidths: state.columnUserWidths,
          sort: state.sort,
          compactMode: state.compactMode,
          collapsedSections: state.collapsedSections,
          panelWidth: state.panelWidth,
          // searchChips intentionally excluded - ephemeral
        }),
        // Migration function for version changes
        migrate: (persistedState, version) => {
          if (version === 0) {
            // Example migration from v0 to v1
            return { ...persistedState, panelWidth: defaultPanelWidth };
          }
          return persistedState as TableState;
        },
      }
    )
  );
}
```

### Pattern 2: Feature Store Instance

```tsx
// src/components/features/pools/stores/pools-table-store.ts
import { createTableStore } from "@/lib/stores/create-table-store";

/**
 * Pools table store.
 * 
 * Persists user preferences for the pools table:
 * - Column visibility and order
 * - Sort state
 * - Compact mode
 * - Collapsed sections
 * - Panel width
 * - Custom column widths
 */
export const usePoolsTableStore = createTableStore({
  storageKey: "pools-table-v1",
  defaultVisibleColumns: ["name", "quota", "capacity", "platforms", "backend"],
  defaultColumnOrder: ["name", "quota", "capacity", "platforms", "backend"],
  defaultSort: { column: "name", direction: "asc" },
  defaultPanelWidth: 40,
});

// Re-export types for convenience
export type { TableState, TableActions, TableStore } from "@/lib/stores/create-table-store";
```

### Pattern 3: Selectors for Performance

```tsx
// ❌ BAD: Re-renders on ANY store change
function PoolsTable() {
  const store = usePoolsTableStore(); // Subscribes to entire store!
  return <table>...</table>;
}

// ✅ GOOD: Only re-renders when specific values change
function PoolsTable() {
  const visibleColumns = usePoolsTableStore((s) => s.visibleColumnIds);
  const columnOrder = usePoolsTableStore((s) => s.columnOrder);
  const sort = usePoolsTableStore((s) => s.sort);
  return <table>...</table>;
}

// ✅ BETTER: Use shallow equality for object selections
import { useShallow } from "zustand/react/shallow";

function PoolsTable() {
  const { visibleColumnIds, columnOrder, sort } = usePoolsTableStore(
    useShallow((s) => ({
      visibleColumnIds: s.visibleColumnIds,
      columnOrder: s.columnOrder,
      sort: s.sort,
    }))
  );
  return <table>...</table>;
}

// ✅ BEST: Create reusable selector hooks
// src/components/features/pools/stores/selectors.ts
import { useShallow } from "zustand/react/shallow";
import { usePoolsTableStore } from "./pools-table-store";

export function usePoolsColumnState() {
  return usePoolsTableStore(
    useShallow((s) => ({
      visibleColumnIds: s.visibleColumnIds,
      columnOrder: s.columnOrder,
      columnUserWidths: s.columnUserWidths,
    }))
  );
}

export function usePoolsSortState() {
  return usePoolsTableStore(
    useShallow((s) => ({
      sort: s.sort,
      setSort: s.setSort,
      clearSort: s.clearSort,
    }))
  );
}

export function usePoolsUIState() {
  return usePoolsTableStore(
    useShallow((s) => ({
      compactMode: s.compactMode,
      collapsedSections: s.collapsedSections,
      panelWidth: s.panelWidth,
    }))
  );
}
```

### Pattern 4: Actions Outside React

```tsx
// Actions can be called outside React components
// Useful for event handlers, effects, etc.

// Get store state without subscribing
const currentSort = usePoolsTableStore.getState().sort;

// Call actions directly
usePoolsTableStore.getState().setSort("name");
usePoolsTableStore.getState().reset();

// Subscribe to changes outside React
const unsubscribe = usePoolsTableStore.subscribe(
  (state) => state.sort,
  (sort, prevSort) => {
    console.log("Sort changed:", prevSort, "→", sort);
  }
);
```

### Pattern 5: Computed/Derived State

```tsx
// ❌ BAD: Computed state inside store (recalculated on every access)
const useStore = create((set, get) => ({
  items: [],
  // BAD: This is recalculated every time
  get filteredItems() {
    return get().items.filter(i => i.active);
  },
}));

// ✅ GOOD: Compute in selectors with memoization
function useFilteredPools() {
  const pools = usePools(); // From API
  const searchChips = usePoolsTableStore((s) => s.searchChips);
  
  return useMemo(() => {
    if (searchChips.length === 0) return pools;
    return pools.filter(pool => matchesChips(pool, searchChips));
  }, [pools, searchChips]);
}

// ✅ GOOD: Compute in headless hooks
// src/headless/use-pools-table.ts
export function usePoolsTable() {
  const { pools } = usePools();
  const { searchChips, sort } = usePoolsTableStore(
    useShallow((s) => ({ searchChips: s.searchChips, sort: s.sort }))
  );
  
  const filteredPools = useMemo(() => 
    filterByChips(pools, searchChips),
    [pools, searchChips]
  );
  
  const sortedPools = useMemo(() =>
    sortPools(filteredPools, sort),
    [filteredPools, sort]
  );
  
  return { pools: sortedPools, ... };
}
```

### Pattern 6: DevTools Integration

```tsx
// Enable Redux DevTools in development
import { devtools, persist } from "zustand/middleware";

export function createTableStore(options: CreateTableStoreOptions) {
  return create<TableStore>()(
    devtools(
      persist(
        immer(stateCreator),
        { name: options.storageKey, ... }
      ),
      { 
        name: options.storageKey,
        enabled: process.env.NODE_ENV === "development",
      }
    )
  );
}
```

### Anti-Patterns: DO NOT DO THIS

```tsx
// ❌ ANTI-PATTERN 1: Store everything in Zustand
const useStore = create((set) => ({
  // BAD: API data belongs in React Query, not Zustand
  pools: [],
  fetchPools: async () => {
    const data = await api.getPools();
    set({ pools: data });
  },
}));

// ✅ CORRECT: API data in React Query, UI state in Zustand
const { pools } = usePools(); // React Query
const { sort, compactMode } = usePoolsTableStore(); // Zustand
```

```tsx
// ❌ ANTI-PATTERN 2: Business logic in store
const useStore = create((set, get) => ({
  pools: [],
  // BAD: Filtering logic in store
  getOnlinePools: () => get().pools.filter(p => p.status === "ONLINE"),
  // BAD: Sorting logic in store  
  getSortedPools: () => [...get().pools].sort((a, b) => a.name.localeCompare(b.name)),
}));

// ✅ CORRECT: Business logic in headless hooks
// Store only holds UI preferences (sort config, not sorted data)
const usePoolsTableStore = create((set) => ({
  sort: { column: "name", direction: "asc" },
  setSort: (column) => set({ ... }),
}));

// Headless hook applies the sort
function usePoolsTable() {
  const { pools } = usePools();
  const sort = usePoolsTableStore((s) => s.sort);
  
  const sortedPools = useMemo(() => 
    applySortConfig(pools, sort), // Business logic here
    [pools, sort]
  );
  
  return { pools: sortedPools };
}
```

```tsx
// ❌ ANTI-PATTERN 3: Subscribing to entire store
function Component() {
  const store = useStore(); // Re-renders on ANY change!
  return <div>{store.someValue}</div>;
}

// ✅ CORRECT: Subscribe to specific slices
function Component() {
  const someValue = useStore((s) => s.someValue);
  return <div>{someValue}</div>;
}
```

```tsx
// ❌ ANTI-PATTERN 4: Mutating state directly
const useStore = create((set) => ({
  items: [],
  addItem: (item) => {
    // BAD: Direct mutation
    set((state) => {
      state.items.push(item); // Mutation!
      return state;
    });
  },
}));

// ✅ CORRECT: Immutable update
const useStore = create((set) => ({
  items: [],
  addItem: (item) => 
    set((state) => ({ items: [...state.items, item] })),
}));

// ✅ BETTER: Use immer middleware
const useStore = create(
  immer((set) => ({
    items: [],
    addItem: (item) => set((state) => { state.items.push(item); }),
  }))
);
```

### Store Organization Checklist

| Question | Answer |
|----------|--------|
| Is this API/server data? | Use React Query, NOT Zustand |
| Is this derived/computed data? | Compute in headless hook with `useMemo` |
| Is this UI preference that should persist? | Zustand with `persist` middleware |
| Is this ephemeral UI state (search query, hover)? | Zustand without persist, OR `useState` |
| Is this global app state? | Zustand in `lib/stores/` |
| Is this feature-specific state? | Zustand in `features/{feature}/stores/` |

---

## Styling & Design System

**CRITICAL:** Follow established patterns from `src/lib/styles.ts` and `workflow-explorer/reactflow-dag/`.

### Existing Style Utilities (USE THESE!)

```tsx
// Import from src/lib/styles.ts - ALREADY EXISTS
import { card, section, heading, text, chip, badge, skeleton, progressTrack, getProgressColor, clearButton } from "@/lib/styles";
import { cn } from "@/lib/utils";

// Card containers
<div className={card.base}>...</div>                    // Standard card
<div className={cn(card.base, card.hover)}>...</div>    // Hoverable card

// Section with dividers
<div className={section.list}>...</div>                 // divide-y pattern

// Typography
<h2 className={heading.section}>Online</h2>             // Section heading
<span className={heading.meta}>(5)</span>               // Count/meta
<p className={text.muted}>Description</p>               // Muted text
<span className={text.hint}>Helper text</span>          // Hint text

// Badges
<span className={badge.success}>Online</span>
<span className={badge.warning}>Maintenance</span>
<span className={badge.info}>Shared</span>

// Chips
<span className={cn("border rounded-full px-2 py-0.5", chip.selected)}>dgx</span>
<span className={cn("border rounded-full px-2 py-0.5", chip.unselected)}>base</span>

// Progress
<div className={progressTrack}>
  <div className={cn("h-2", getProgressColor(75))} style={{ width: "75%" }} />
</div>

// Skeleton loading
<div className={cn(skeleton.base, skeleton.md, "w-24")} />
```

### Color Palette (Zinc-based)

```css
/* Dashboard uses zinc for neutrals - FOLLOW THIS */
:root {
  /* Surfaces */
  --surface-bg: white;
  --surface-elevated: theme(colors.zinc.50);
  
  /* Borders */
  --border: theme(colors.zinc.200);
  --border-subtle: theme(colors.zinc.100);
  
  /* Text */
  --text-primary: theme(colors.zinc.900);
  --text-secondary: theme(colors.zinc.500);
  --text-tertiary: theme(colors.zinc.400);
}

.dark {
  --surface-bg: theme(colors.zinc.950);
  --surface-elevated: theme(colors.zinc.900);
  
  --border: theme(colors.zinc.800);
  --border-subtle: theme(colors.zinc.800/50);
  
  --text-primary: theme(colors.zinc.100);
  --text-secondary: theme(colors.zinc.400);
  --text-tertiary: theme(colors.zinc.500);
}
```

### Status Colors (Match DAG + Pool Status)

```tsx
// Pool status colors - align with DAG status patterns
export const POOL_STATUS_STYLES = {
  ONLINE: {
    bg: "bg-emerald-50 dark:bg-emerald-950/60",
    border: "border-emerald-400 dark:border-emerald-600",
    text: "text-emerald-600 dark:text-emerald-400",
    dot: "bg-emerald-500",
    icon: "🟢",
  },
  MAINTENANCE: {
    bg: "bg-amber-50 dark:bg-amber-950/60",
    border: "border-amber-400 dark:border-amber-500",
    text: "text-amber-600 dark:text-amber-400",
    dot: "bg-amber-500",
    icon: "🟡",
  },
  OFFLINE: {
    bg: "bg-red-50 dark:bg-red-950/60",
    border: "border-red-400 dark:border-red-500",
    text: "text-red-600 dark:text-red-400",
    dot: "bg-red-500",
    icon: "🔴",
  },
} as const;
```

### Light/Dark Mode Pattern

**CRITICAL:** The dashboard uses `next-themes` with the `.dark` class on `<html>`. ALL UI must work in both modes.

#### How Dark Mode Works

```
1. next-themes adds/removes .dark class on <html> element
2. Tailwind's dark: variant activates when .dark class is present
3. CSS custom properties in :root vs .dark provide theme values
4. Browser respects prefers-color-scheme for initial load
```

#### Tailwind dark: Prefix Rules

```tsx
// ✅ CORRECT: Always include dark: variant for EVERY color
<div className="bg-white dark:bg-zinc-950" />
<span className="text-zinc-900 dark:text-zinc-100" />
<div className="border-zinc-200 dark:border-zinc-800" />
<div className="hover:bg-zinc-100 dark:hover:bg-zinc-800" />

// ✅ CORRECT: Ring and focus states
<button className="focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400" />

// ✅ CORRECT: Opacity modifiers work with dark:
<div className="bg-blue-500/10 dark:bg-blue-400/20" />

// ❌ WRONG: Missing dark mode - BREAKS IN DARK MODE!
<div className="bg-white" />                    // White on dark bg = glaring
<span className="text-zinc-900" />              // Dark text invisible on dark bg
<div className="border-zinc-200" />             // Border invisible in dark

// ❌ WRONG: Using gray instead of zinc
<div className="bg-gray-100 dark:bg-gray-900" />  // Use zinc for consistency
```

#### Color Pairing Cheat Sheet

| Light Mode | Dark Mode | Use Case |
|------------|-----------|----------|
| `bg-white` | `dark:bg-zinc-950` | Page background |
| `bg-zinc-50` | `dark:bg-zinc-900` | Elevated surface, card |
| `bg-zinc-100` | `dark:bg-zinc-800` | Table header, hover |
| `text-zinc-900` | `dark:text-zinc-100` | Primary text |
| `text-zinc-700` | `dark:text-zinc-300` | Secondary text |
| `text-zinc-500` | `dark:text-zinc-400` | Muted text |
| `text-zinc-400` | `dark:text-zinc-500` | Hint/placeholder |
| `border-zinc-200` | `dark:border-zinc-800` | Standard border |
| `border-zinc-300` | `dark:border-zinc-700` | Strong border |
| `divide-zinc-200` | `dark:divide-zinc-800` | List dividers |
| `ring-blue-500` | `dark:ring-blue-400` | Focus ring |

#### Status Colors (Both Modes)

```tsx
// Use opacity with semantic colors for dark mode
const STATUS_CLASSES = {
  ONLINE: {
    light: "bg-emerald-50 border-emerald-400 text-emerald-600",
    dark: "dark:bg-emerald-950/60 dark:border-emerald-600 dark:text-emerald-400",
  },
  MAINTENANCE: {
    light: "bg-amber-50 border-amber-400 text-amber-600",
    dark: "dark:bg-amber-950/60 dark:border-amber-500 dark:text-amber-400",
  },
  OFFLINE: {
    light: "bg-red-50 border-red-400 text-red-600",
    dark: "dark:bg-red-950/60 dark:border-red-500 dark:text-red-400",
  },
};

// Usage: combine both
<div className={cn(STATUS_CLASSES.ONLINE.light, STATUS_CLASSES.ONLINE.dark)} />
```

#### CSS Custom Properties (Preferred for Complex Theming)

```css
/* src/app/(dashboard)/pools/pools.css */

:root {
  /* Pools-specific light mode */
  --pools-surface: theme(colors.white);
  --pools-surface-elevated: theme(colors.zinc.50);
  --pools-border: theme(colors.zinc.200);
  --pools-text-primary: theme(colors.zinc.900);
  --pools-text-secondary: theme(colors.zinc.500);
  
  /* Status */
  --pools-status-online-bg: theme(colors.emerald.50);
  --pools-status-online-text: theme(colors.emerald.600);
  --pools-status-maintenance-bg: theme(colors.amber.50);
  --pools-status-maintenance-text: theme(colors.amber.600);
  --pools-status-offline-bg: theme(colors.red.50);
  --pools-status-offline-text: theme(colors.red.600);
  
  /* Shadows (more visible in light mode) */
  --pools-panel-shadow: -4px 0 16px -4px rgba(0, 0, 0, 0.1);
}

.dark {
  /* Pools-specific dark mode */
  --pools-surface: theme(colors.zinc.950);
  --pools-surface-elevated: theme(colors.zinc.900);
  --pools-border: theme(colors.zinc.800);
  --pools-text-primary: theme(colors.zinc.100);
  --pools-text-secondary: theme(colors.zinc.400);
  
  /* Status (with alpha for subtlety) */
  --pools-status-online-bg: theme(colors.emerald.950 / 60%);
  --pools-status-online-text: theme(colors.emerald.400);
  --pools-status-maintenance-bg: theme(colors.amber.950 / 60%);
  --pools-status-maintenance-text: theme(colors.amber.400);
  --pools-status-offline-bg: theme(colors.red.950 / 60%);
  --pools-status-offline-text: theme(colors.red.400);
  
  /* Shadows (heavier in dark mode for visibility) */
  --pools-panel-shadow: -4px 0 16px -4px rgba(0, 0, 0, 0.4);
}

/* Use CSS vars in components */
.pools-panel {
  background: var(--pools-surface);
  box-shadow: var(--pools-panel-shadow);
}
```

#### Data-Attribute Theming (Best for Status)

```css
/* Avoid JS-driven className changes for status styling */
/* CSS handles both light AND dark in one selector */

.pools-row[data-status="online"] {
  background: var(--pools-status-online-bg);
  border-left: 3px solid var(--pools-status-online-border);
}

/* The .dark class automatically switches CSS variable values! */
```

#### Testing Dark Mode

```tsx
// Manual toggle in dev:
document.documentElement.classList.toggle('dark');

// In tests - render both modes:
it('renders correctly in light mode', () => {
  render(<Component />);
  // assertions
});

it('renders correctly in dark mode', () => {
  document.documentElement.classList.add('dark');
  render(<Component />);
  // assertions
  document.documentElement.classList.remove('dark');
});
```

#### Common Dark Mode Bugs to Avoid

| Bug | Symptom | Fix |
|-----|---------|-----|
| Missing `dark:` on text | Invisible text in dark mode | Add `dark:text-zinc-*` |
| Missing `dark:` on bg | Glaring white boxes | Add `dark:bg-zinc-*` |
| Hardcoded colors | Doesn't respond to theme | Use Tailwind classes or CSS vars |
| Wrong shadow opacity | Invisible/too harsh shadows | Use `rgba(0,0,0,0.1)` light, `0.4` dark |
| Using `gray-*` | Inconsistent with rest of UI | Use `zinc-*` |
| Hover state missing dark | Jarring hover in dark mode | Add `dark:hover:bg-*` |

#### Dark Mode Checklist (Per Component)

Before marking any component complete:

- [ ] Every `bg-*` has a `dark:bg-*` pair
- [ ] Every `text-*` has a `dark:text-*` pair
- [ ] Every `border-*` has a `dark:border-*` pair
- [ ] Every `divide-*` has a `dark:divide-*` pair
- [ ] Every `ring-*` has a `dark:ring-*` pair
- [ ] Every `hover:*` has a `dark:hover:*` equivalent
- [ ] Shadows are adjusted for dark mode visibility
- [ ] Focus states are visible in both modes
- [ ] Status colors use the defined palette
- [ ] Tested visually in both modes via theme toggle

### Table Styling (From DAG TaskTable)

```tsx
// Table header
<div className="grid items-center gap-6 border-b border-gray-200 bg-gray-100 dark:border-zinc-700 dark:bg-zinc-800 px-3 py-2 text-xs font-medium text-gray-500 dark:text-zinc-400">

// Table row
<div className="grid items-center gap-6 border-b border-gray-200 dark:border-zinc-800 px-3 py-2 hover:bg-gray-50 dark:hover:bg-zinc-800/50 cursor-pointer transition-colors">

// Table row (selected)
<div className="grid items-center gap-6 border-b border-gray-200 dark:border-zinc-800 px-3 py-2 bg-blue-50 dark:bg-blue-950/30">

// Cell text styles
<span className="font-medium text-gray-900 dark:text-zinc-100">{name}</span>
<span className="text-gray-500 dark:text-zinc-400">{description}</span>
<span className="tabular-nums text-gray-500 dark:text-zinc-400">{count}</span>
<span className="font-mono text-xs text-gray-500 dark:text-zinc-400">{code}</span>
```

### Progress Bars (GPU Usage)

```tsx
// Dual progress bar (quota + capacity)
function GpuProgressCell({ quota }: { quota: Quota }) {
  const quotaPercent = (quota.used / quota.limit) * 100;
  const capacityPercent = (quota.totalUsage / quota.totalCapacity) * 100;
  
  return (
    <div className="space-y-1">
      {/* Quota bar */}
      <div className="flex items-center gap-2">
        <div className={cn(progressTrack, "h-1.5 flex-1")}>
          <div 
            className={cn("h-full rounded-full transition-all", getProgressColor(quotaPercent))}
            style={{ width: `${quotaPercent}%` }}
          />
        </div>
        <span className="text-xs tabular-nums text-gray-500 dark:text-zinc-400 w-16 text-right">
          {quota.used}/{quota.limit}
        </span>
      </div>
    </div>
  );
}
```

### Pills/Chips (Platform Pills)

```tsx
// Platform pill - follows chip pattern from styles.ts
<span className={cn(
  "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium",
  chip.unselected
)}>
  {platform}
</span>

// +N overflow pill
<span className={cn(
  "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium",
  chip.action
)}>
  +{overflow}
</span>
```

### Panel Styling (From DAG DetailsPanel)

```tsx
// Panel container
<aside className="flex flex-col border-l border-gray-200 bg-white dark:border-zinc-700 dark:bg-zinc-900 shadow-lg">
  {/* Header */}
  <header className="flex items-center justify-between border-b border-gray-200 dark:border-zinc-700 px-4 py-3">
    <h2 className="text-sm font-semibold text-gray-900 dark:text-zinc-100">
      {title}
    </h2>
    <button className={clearButton}>
      <X className="h-4 w-4" />
    </button>
  </header>
  
  {/* Content */}
  <div className="flex-1 overflow-auto p-4">
    {children}
  </div>
</aside>
```

### Resize Handle Styling

```tsx
// From DAG DetailsPanel
<div
  className={cn(
    "group absolute top-0 z-20 h-full w-1 cursor-ew-resize",
    isDragging ? "bg-blue-500" : "bg-transparent hover:bg-gray-400 dark:hover:bg-zinc-600",
  )}
>
  <div
    className={cn(
      "absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded bg-gray-300 dark:bg-zinc-700 px-0.5 py-1 shadow-md transition-opacity duration-150",
      isDragging ? "opacity-100" : "opacity-0 group-hover:opacity-100",
    )}
  >
    <GripVertical className="size-4 text-gray-600 dark:text-zinc-300" />
  </div>
</div>
```

### Collapsible Section Styling

```tsx
// Section header (clickable)
<button className="mb-2 flex w-full items-center gap-2 text-left">
  <ChevronDown className={cn(
    "h-4 w-4 text-zinc-400 transition-transform",
    isCollapsed && "-rotate-90"
  )} />
  <span className="text-sm">{icon}</span>
  <span className={heading.section}>{label}</span>
  <span className={heading.meta}>({count})</span>
</button>
```

### Search/OmniSearch Styling

```tsx
// Search chip
<span className="inline-flex items-center gap-1 rounded-full bg-blue-100 dark:bg-blue-900/40 px-2 py-0.5 text-xs font-medium text-blue-700 dark:text-blue-300">
  {label}
  <button className="hover:text-blue-900 dark:hover:text-blue-100">
    <X className="size-3" />
  </button>
</span>

// Search input wrapper
<div className="flex flex-wrap items-center gap-1.5 rounded-md border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2">
  {chips}
  <input className="flex-1 min-w-[200px] bg-transparent outline-none placeholder:text-zinc-400" />
</div>
```

### CSS Custom Properties (From DAG dag.css)

```css
/* Create pools.css following dag.css pattern */

/* Pools-specific CSS variables */
:root {
  /* Status colors */
  --pools-status-online-bg: theme(colors.emerald.50);
  --pools-status-online-border: theme(colors.emerald.400);
  --pools-status-online-text: theme(colors.emerald.600);
  
  --pools-status-maintenance-bg: theme(colors.amber.50);
  --pools-status-maintenance-border: theme(colors.amber.400);
  --pools-status-maintenance-text: theme(colors.amber.600);
  
  --pools-status-offline-bg: theme(colors.red.50);
  --pools-status-offline-border: theme(colors.red.400);
  --pools-status-offline-text: theme(colors.red.600);
  
  /* Table */
  --pools-row-height: 3rem;
  --pools-row-height-compact: 2.25rem;
  
  /* Panel */
  --pools-panel-shadow: -0.25rem 0 1rem -0.25rem rgba(0, 0, 0, 0.1);
}

.dark {
  --pools-status-online-bg: theme(colors.emerald.950 / 60%);
  --pools-status-online-border: theme(colors.emerald.600);
  --pools-status-online-text: theme(colors.emerald.400);
  
  /* ... dark mode overrides */
  
  --pools-panel-shadow: -0.25rem 0 1rem -0.25rem rgba(0, 0, 0, 0.3);
}

/* Data-attribute styling (avoids JS recalculation) */
.pools-row[data-status="online"] {
  background: var(--pools-status-online-bg);
  border-left: 3px solid var(--pools-status-online-border);
}

.pools-row[data-status="maintenance"] {
  background: var(--pools-status-maintenance-bg);
  border-left: 3px solid var(--pools-status-maintenance-border);
}

.pools-row[data-status="offline"] {
  background: var(--pools-status-offline-bg);
  border-left: 3px solid var(--pools-status-offline-border);
}
```

### Styling Checklist

Before merging, verify:

- [ ] All colors use zinc palette for neutrals
- [ ] All components have dark: variants
- [ ] Status colors match DAG patterns (emerald/amber/red)
- [ ] Using `cn()` for conditional classes
- [ ] Using styles from `src/lib/styles.ts` where applicable
- [ ] Table styling matches DAG TaskTable
- [ ] Panel styling matches DAG DetailsPanel
- [ ] Progress bars use `progressTrack` and `getProgressColor()`
- [ ] Chips/pills use `chip.*` patterns
- [ ] Created `pools.css` with CSS custom properties
- [ ] Data-attributes used for status styling (not JS classNames)

---

## Best Practices & Performance Optimizations

**CRITICAL:** These patterns are battle-tested in `workflow-explorer/reactflow-dag/`. Apply them consistently.

### 1. CSS Performance Patterns

#### Use CSS Custom Properties for Theming

```css
/* Define variables for light/dark mode in a dedicated CSS file */
:root {
  --pools-surface: oklch(1 0 0);
  --pools-border: oklch(0.9 0 0);
  --pools-text: oklch(0.2 0 0);
  --pools-status-online: oklch(0.55 0.15 160);
  --pools-status-maintenance: oklch(0.55 0.15 80);
  --pools-status-offline: oklch(0.55 0.2 25);
}

.dark {
  --pools-surface: oklch(0.16 0 0);
  --pools-border: oklch(0.28 0 0);
  --pools-text: oklch(0.95 0 0);
  /* ... dark mode overrides */
}
```

#### Use data-attributes for Status Styling (No JS Recalculation)

```tsx
// ❌ BAD: JS-driven className changes cause style recalculation
<div className={cn(
  "pool-row",
  status === "ONLINE" && "bg-green-50",
  status === "OFFLINE" && "bg-red-50",
)} />

// ✅ GOOD: data-attribute styling, no JS recalculation
<div className="pool-row" data-status={status.toLowerCase()} />
```

```css
/* CSS handles the styling */
.pool-row[data-status="online"] {
  background: var(--pools-status-online-bg);
  border-color: var(--pools-status-online-border);
}
.pool-row[data-status="offline"] {
  background: var(--pools-status-offline-bg);
  border-color: var(--pools-status-offline-border);
}
```

#### CSS Containment Classes

```css
/**
 * Strict containment - maximum layout isolation.
 * Use for table rows, list items, cards that don't affect siblings.
 */
.pools-contained {
  contain: layout style paint;
}

/**
 * Virtual list items - maximum isolation + content-visibility.
 */
.pools-virtual-item {
  contain: strict;
  content-visibility: auto;
}

/**
 * GPU acceleration - ONLY during active animations.
 * WARNING: Static use causes blurry text at different zoom levels.
 */
.pools-gpu-accelerated {
  will-change: transform;
}

/**
 * Panel containers - layout + style containment only (allows paint overflow).
 */
.pools-panel {
  contain: layout style;
}
```

#### Reduced Motion Support

```css
@media (prefers-reduced-motion: reduce) {
  .pool-row,
  .pool-progress-bar {
    transition: none;
  }
  
  .pools-spinner {
    animation: none;
  }
}
```

### 2. Component Architecture Patterns

#### Context for Stable Callback References

```tsx
// ❌ BAD: Callbacks in component data trigger re-renders
<PoolRow
  pool={pool}
  onSelect={() => handleSelect(pool)}  // New function every render!
/>

// ✅ GOOD: Context provides stable callbacks
const PoolsContext = createContext<{
  onSelectPool: (pool: Pool) => void;
  onToggleSection: (status: string) => void;
} | null>(null);

// In provider (memoized callbacks)
const handleSelectPool = useCallback((pool: Pool) => {
  setSelectedPool(pool.name);
}, []);

// In row component
const { onSelectPool } = usePoolsContext();
<div onClick={() => onSelectPool(pool)} />  // Stable reference!
```

#### Aggressive Memoization

```tsx
// Memoize row components with custom comparison
const PoolRow = memo(function PoolRow({ pool, isSelected, gridTemplate }: Props) {
  // ...
}, (prev, next) => (
  prev.pool === next.pool &&
  prev.isSelected === next.isSelected &&
  prev.gridTemplate === next.gridTemplate
));

// Memoize expensive computations
const gridTemplate = useMemo(() => 
  buildGridTemplate(columns, columnUserWidths),
  [columns, columnUserWidths]
);

// Memoize derived data
const filteredPools = useMemo(() => 
  filterByChips(pools, globalFilterChips),
  [pools, globalFilterChips]
);
```

#### Pure Functions Outside Components

```tsx
// ❌ BAD: Function recreated every render
function PoolsTable({ pools }) {
  const getStatusIcon = (status: string) => {  // Recreated!
    switch (status) { /* ... */ }
  };
}

// ✅ GOOD: Pure function defined outside component
function getStatusIcon(status: string): ReactNode {
  const category = STATUS_CATEGORY_MAP[status];
  return <StatusIcon category={category} />;
}

function PoolsTable({ pools }) {
  // Use the stable external function
  return pools.map(pool => (
    <div>{getStatusIcon(pool.status)}</div>
  ));
}
```

### 3. State Management Patterns

#### Cancellation Pattern for Async Operations

```tsx
useEffect(() => {
  let cancelled = false;

  const loadData = async () => {
    setIsLoading(true);
    try {
      const result = await fetchPools();
      if (!cancelled) {
        setPools(result);
      }
    } catch (error) {
      if (!cancelled) {
        setError(error);
      }
    } finally {
      if (!cancelled) {
        setIsLoading(false);
      }
    }
  };

  loadData();

  return () => {
    cancelled = true;
  };
}, [dependency]);
```

#### Pre-computed Lookup Maps (O(1) Access)

```tsx
// ❌ BAD: O(n) lookup every time
function getPoolStatus(poolName: string) {
  return pools.find(p => p.name === poolName)?.status;
}

// ✅ GOOD: Pre-compute map for O(1) access
const POOL_COLUMN_MAP = new Map(POOL_COLUMNS.map(c => [c.id, c]));
const STATUS_CATEGORY_MAP: Record<string, StatusCategory> = {
  ONLINE: "online",
  MAINTENANCE: "maintenance", 
  OFFLINE: "offline",
};

// O(1) lookup
const category = STATUS_CATEGORY_MAP[pool.status];
const column = POOL_COLUMN_MAP.get("quota");
```

#### Single-Pass Computation

```tsx
// ❌ BAD: Multiple passes over data
const onlinePools = pools.filter(p => p.status === "ONLINE");
const offlinePools = pools.filter(p => p.status === "OFFLINE");
const maintenancePools = pools.filter(p => p.status === "MAINTENANCE");
const totalQuota = pools.reduce((sum, p) => sum + p.quotaUsed, 0);

// ✅ GOOD: Single pass computes everything
interface PoolStats {
  byStatus: Map<string, Pool[]>;
  totalQuota: number;
  totalCapacity: number;
}

function computePoolStats(pools: Pool[]): PoolStats {
  const byStatus = new Map<string, Pool[]>();
  let totalQuota = 0;
  let totalCapacity = 0;

  for (const pool of pools) {
    const list = byStatus.get(pool.status) ?? [];
    list.push(pool);
    byStatus.set(pool.status, list);
    totalQuota += pool.quotaUsed;
    totalCapacity += pool.totalUsage;
  }

  return { byStatus, totalQuota, totalCapacity };
}
```

### 4. Caching Patterns

#### Grid Template Cache

```tsx
const gridTemplateCache = new Map<string, string>();

function getGridTemplate(columns: ColumnDef[], userWidths: ColumnUserWidths): string {
  // Create cache key from column IDs + user widths
  const key = columns.map(c => {
    const user = userWidths[c.id];
    return user ? `${c.id}:${user.value}:${user.mode}` : c.id;
  }).join(",");
  
  let cached = gridTemplateCache.get(key);
  if (cached) return cached;

  cached = columns.map(col => {
    const user = userWidths[col.id];
    if (user?.mode === 'fixed') return `${user.value}px`;
    const min = user?.value ?? col.width.min;
    return `minmax(${min}px, ${col.width.share}fr)`;
  }).join(" ");

  gridTemplateCache.set(key, cached);
  return cached;
}
```

#### Chrono-node Lazy Loading (for Smart Search)

```tsx
// Lazy-load heavy dependencies with idle prefetch
let chronoModule: typeof import("chrono-node") | null = null;

if (typeof window !== "undefined" && "requestIdleCallback" in window) {
  requestIdleCallback(() => {
    import("chrono-node").then(m => { chronoModule = m; });
  }, { timeout: 5000 });
}

function parseDateTime(input: string): Date | null {
  if (!chronoModule) return null;  // Graceful degradation
  return chronoModule.parseDate(input);
}
```

### 5. Code Organization Patterns

#### File Structure

```
pools/
├── constants.ts           # Dimensions, styling, thresholds
├── types.ts               # TypeScript interfaces
├── context.tsx            # React context for callbacks
├── store.ts               # Zustand store
├── columns.ts             # Column definitions
├── components/
│   ├── index.ts           # Barrel exports
│   ├── PoolsTable.tsx     # Main table component
│   ├── PoolRow.tsx        # Memoized row
│   ├── PoolPanel.tsx      # Details panel
│   └── ...
├── hooks/
│   ├── index.ts           # Barrel exports
│   ├── use-pools-data.ts  # Data fetching
│   └── use-panel-resize.ts
└── utils/
    ├── index.ts           # Barrel exports
    ├── status.tsx         # Status icons, colors
    └── filters.ts         # Filter logic
```

#### DocBlock Comments on Every File

```tsx
// Copyright header...

/**
 * PoolsTable Component
 *
 * Main table component for displaying pools with:
 * - Status-based sections (Online, Maintenance, Offline)
 * - Virtualized rows for performance
 * - Column reordering via drag-and-drop
 * - Smart search with filter chips
 *
 * Architecture:
 * - Uses TanStack Table for sorting/filtering logic
 * - Uses Zustand for state persistence
 * - Uses CSS grid for column alignment
 */

"use client";

import { /* ... */ } from "react";
```

#### Barrel Exports for Clean Imports

```tsx
// components/index.ts
export { PoolsTable } from "./PoolsTable";
export { PoolRow } from "./PoolRow";
export { PoolPanel } from "./PoolPanel";
export { GpuProgressCell } from "./GpuProgressCell";
export { PlatformPills } from "./PlatformPills";

// Usage: clean single import
import { PoolsTable, PoolRow, PoolPanel } from "./components";
```

### 6. Accessibility Patterns

#### Skip Links

```tsx
<a
  href="#pools-table"
  className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:rounded-md focus:bg-gray-100 focus:px-4 focus:py-2"
>
  Skip to pools table
</a>
```

#### ARIA Labels

```tsx
<main id="pools-table" role="application" aria-label="Pools table">
  <div role="table" aria-label="Pools list" aria-rowcount={pools.length}>
    <div role="rowgroup">
      <div role="row">
        <div role="columnheader" aria-sort={sort.column === "name" ? sort.direction : undefined}>
          Pool Name
        </div>
      </div>
    </div>
  </div>
</main>
```

#### Keyboard Navigation

```tsx
const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    onSelect();
  }
}, [onSelect]);

<div
  role="row"
  tabIndex={0}
  onClick={onSelect}
  onKeyDown={handleKeyDown}
  aria-selected={isSelected}
/>
```

### 7. Error Boundaries

```tsx
import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class PoolsErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Pools table error:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback ?? (
        <div className="p-8 text-center">
          <p className="text-red-500">Failed to load pools table</p>
          <button onClick={() => this.setState({ hasError: false, error: null })}>
            Retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
```

---

## Maximize Library Usage: Minimize Custom Code

**Goal:** Write as little custom code as possible. Leverage existing libraries first.

### Already Installed — USE MORE

| Library | Already Using | **Should Also Use** |
|---------|---------------|---------------------|
| `@tanstack/react-table` | ❌ Not yet | ✅ Column resizing, visibility, sorting, filtering, ordering |
| `cmdk` (via `command.tsx`) | ❌ Not yet | ✅ Smart search with autocomplete |
| `nuqs` | ❌ Not yet | ✅ URL state for shareable filters |
| `zustand` | ❌ Not yet | ✅ Persist middleware, immer middleware |
| `@dnd-kit/*` | ✅ Columns | ✅ Keep for column reordering |
| `@tanstack/react-virtual` | ✅ Lists | ✅ Keep for virtualization |
| `@radix-ui/*` | ✅ Some | ✅ Collapsible, Progress, ScrollArea |
| `zod` | ✅ Forms | ✅ Search chip validation |
| `chrono-node` | ✅ DAG | ✅ Date parsing in smart search |

### TanStack Table: Use Built-in Features

**❌ DON'T write custom code for:**

```tsx
// ❌ BAD: Custom column visibility state
const [visibleColumns, setVisibleColumns] = useState(["name", "quota"]);
const filteredColumns = columns.filter(c => visibleColumns.includes(c.id));

// ❌ BAD: Custom sorting
const [sort, setSort] = useState({ column: "name", direction: "asc" });
const sortedData = useMemo(() => [...data].sort(...), [data, sort]);

// ❌ BAD: Custom column resizing
const [columnWidths, setColumnWidths] = useState({});
const handleResize = (id, width) => setColumnWidths({...});
```

**✅ DO use TanStack Table's built-in:**

```tsx
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  ColumnResizeMode,
} from "@tanstack/react-table";

const table = useReactTable({
  data: pools,
  columns,
  getCoreRowModel: getCoreRowModel(),
  
  // ✅ Built-in sorting
  getSortedRowModel: getSortedRowModel(),
  onSortingChange: setSorting,
  state: { sorting },
  
  // ✅ Built-in column visibility
  onColumnVisibilityChange: setColumnVisibility,
  state: { columnVisibility },
  
  // ✅ Built-in column ordering
  onColumnOrderChange: setColumnOrder,
  state: { columnOrder },
  
  // ✅ Built-in column resizing
  columnResizeMode: "onChange" as ColumnResizeMode,
  onColumnSizingChange: setColumnSizing,
  state: { columnSizing },
  
  // ✅ Built-in global filtering
  onGlobalFilterChange: setGlobalFilter,
  getFilteredRowModel: getFilteredRowModel(),
  state: { globalFilter },
});

// Use table APIs directly
table.getHeaderGroups();      // For header rendering
table.getRowModel().rows;     // For body rendering
table.getColumn("name")?.toggleSorting();  // Toggle sort
table.getColumn("quota")?.toggleVisibility();  // Toggle visibility
table.getState().columnSizing;  // Get current sizes
```

### cmdk: Omni Search (Already Installed!)

**You already have `cmdk` via `command.tsx`!** Use it as an **inline omni search** with chips — NOT a modal dialog.

**Omni Search Pattern (like GroupPanel SmartSearch):**
- **Inline** in table header (not a modal popup)
- Type freely → suggestions appear as dropdown below
- Select suggestion → adds as chip
- Multiple chips = AND filter
- Chips displayed inline, removable with X
- Supports `field:value` prefixes (e.g., `status:online`)
- Natural language date parsing via chrono-node
- Free-text search on Enter (searches name by default)

```tsx
// src/components/ui/smart-search/SmartSearch.tsx
import { useState, useRef, useMemo } from "react";
import { Command, CommandInput, CommandList, CommandGroup, CommandItem, CommandEmpty } from "@/components/ui/command";
import { X } from "lucide-react";
import type { SearchChip, SearchField } from "./types";

interface SmartSearchProps<T> {
  data: T[];
  fields: SearchField<T>[];
  chips: SearchChip[];
  onChipsChange: (chips: SearchChip[]) => void;
  placeholder?: string;
}

export function SmartSearch<T>({
  data,
  fields,
  chips,
  onChipsChange,
  placeholder = "Search... (try 'status:online' or 'platform:dgx')",
}: SmartSearchProps<T>) {
  const [inputValue, setInputValue] = useState("");
  const [isFocused, setIsFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Parse input for field prefix (e.g., "status:" → { field, query })
  const parsedInput = useMemo(() => {
    const colonIndex = inputValue.indexOf(":");
    if (colonIndex > 0) {
      const prefix = inputValue.slice(0, colonIndex + 1);
      const field = fields.find(f => f.prefix === prefix);
      if (field) {
        return { field, query: inputValue.slice(colonIndex + 1) };
      }
    }
    return { field: null, query: inputValue };
  }, [inputValue, fields]);

  // Get suggestions based on current input
  const suggestions = useMemo(() => {
    if (!parsedInput.field) {
      // Show field prefixes as suggestions
      return fields.map(f => ({
        type: "prefix" as const,
        field: f,
        value: f.prefix,
        label: `${f.label}: ...`,
      }));
    }
    // Show values for the selected field
    const values = parsedInput.field.getValues(data);
    const filtered = values.filter(v => 
      v.toLowerCase().includes(parsedInput.query.toLowerCase())
    );
    return filtered.slice(0, 10).map(v => ({
      type: "value" as const,
      field: parsedInput.field!,
      value: v,
      label: `${parsedInput.field!.label}: ${v}`,
    }));
  }, [parsedInput, fields, data]);

  const addChip = (field: SearchField<T>, value: string) => {
    onChipsChange([...chips, { field: field.id, value, label: `${field.label}: ${value}` }]);
    setInputValue("");
    inputRef.current?.focus();
  };

  const removeChip = (index: number) => {
    onChipsChange(chips.filter((_, i) => i !== index));
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Backspace" && inputValue === "" && chips.length > 0) {
      removeChip(chips.length - 1);
    }
    if (e.key === "Enter" && inputValue && !parsedInput.field) {
      // Free-text search
      const freeField = fields.find(f => f.id === "name");
      if (freeField) addChip(freeField, inputValue);
    }
  };

  return (
    <Command className="relative border rounded-md" shouldFilter={false}>
      {/* Inline chips + input row */}
      <div className="flex flex-wrap items-center gap-1.5 px-3 py-2">
        {chips.map((chip, index) => (
          <span
            key={`${chip.field}-${chip.value}-${index}`}
            className="inline-flex items-center gap-1 rounded-full bg-blue-100 dark:bg-blue-900/40 px-2 py-0.5 text-xs font-medium text-blue-700 dark:text-blue-300"
          >
            {chip.label}
            <button onClick={() => removeChip(index)} className="hover:text-blue-900">
              <X className="size-3" />
            </button>
          </span>
        ))}
        <CommandInput
          ref={inputRef}
          value={inputValue}
          onValueChange={setInputValue}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setTimeout(() => setIsFocused(false), 200)}
          onKeyDown={handleKeyDown}
          placeholder={chips.length === 0 ? placeholder : "Add filter..."}
          className="flex-1 min-w-[200px] border-0 p-0"
        />
      </div>

      {/* Dropdown suggestions */}
      {isFocused && (inputValue || chips.length === 0) && (
        <CommandList className="absolute top-full left-0 right-0 z-50 mt-1 border rounded-md bg-white dark:bg-zinc-900 shadow-lg max-h-[300px] overflow-auto">
          <CommandEmpty>No matches. Press Enter for free-text search.</CommandEmpty>
          
          {!parsedInput.field && (
            <CommandGroup heading="Filter by">
              {fields.map(field => (
                <CommandItem key={field.id} onSelect={() => setInputValue(field.prefix)}>
                  <span className="font-mono text-xs text-blue-600 mr-2">{field.prefix}</span>
                  {field.label}
                </CommandItem>
              ))}
            </CommandGroup>
          )}
          
          {parsedInput.field && suggestions.length > 0 && (
            <CommandGroup heading={parsedInput.field.label}>
              {suggestions.map((s, i) => (
                <CommandItem key={`${s.value}-${i}`} onSelect={() => addChip(s.field, s.value)}>
                  {s.value}
                </CommandItem>
              ))}
            </CommandGroup>
          )}
        </CommandList>
      )}
    </Command>
  );
}
```

**Key Difference: Inline vs Modal**

```tsx
// ❌ Modal pattern (command palette - NOT what we want)
<button onClick={() => setOpen(true)}>Search... ⌘K</button>
<CommandDialog open={open}>...</CommandDialog>

// ✅ Inline omni search pattern (what we want)
<Command className="relative">
  <div className="flex flex-wrap gap-1">
    {chips.map(chip => <Chip />)}      {/* Chips inline */}
    <CommandInput />                    {/* Input inline */}
  </div>
  <CommandList className="absolute">   {/* Dropdown below */}
    ...suggestions
  </CommandList>
</Command>
```

**Pool Search Fields (business-specific):**

```tsx
// src/components/features/pools/pool-search-fields.ts
export const POOL_SEARCH_FIELDS: SearchField<Pool>[] = [
  {
    id: "name",
    label: "Name",
    prefix: "name:",
    getValues: (pools) => pools.map(p => p.name),
    match: (pool, value) => pool.name.toLowerCase().includes(value.toLowerCase()),
  },
  {
    id: "status",
    label: "Status", 
    prefix: "status:",
    getValues: () => ["online", "maintenance", "offline"],
    match: (pool, value) => pool.status.toLowerCase() === value.toLowerCase(),
  },
  {
    id: "platform",
    label: "Platform",
    prefix: "platform:",
    getValues: (pools) => [...new Set(pools.flatMap(p => p.platforms))].sort(),
    match: (pool, value) => pool.platforms.some(p => p.toLowerCase().includes(value.toLowerCase())),
  },
  {
    id: "backend",
    label: "Backend",
    prefix: "backend:",
    getValues: (pools) => [...new Set(pools.map(p => p.backend))].sort(),
    match: (pool, value) => pool.backend.toLowerCase() === value.toLowerCase(),
  },
];
```

**User Experience Flow:**

```
1. User focuses search box
   → Shows: "Filter by: name: status: platform: backend:"

2. User types "sta"
   → Shows: "status:" highlighted (fuzzy match)

3. User selects "status:" or types "status:"
   → Shows: "online", "maintenance", "offline"

4. User selects "online"
   → Chip appears: [Status: online ×]
   → Input clears, ready for next filter

5. User types "dgx" and presses Enter
   → Chip appears: [Name: dgx ×]  (free-text search)

6. Two chips now: [Status: online ×] [Name: dgx ×]
   → Table filters to: status=online AND name contains "dgx"
```

**Sync with nuqs (URL State):**

```tsx
// Chips ↔ URL sync
function usePoolsSearch() {
  const [params, setParams] = useQueryStates(poolsSearchParams);
  
  // Convert URL → chips for display
  const chips = useMemo(() => urlParamsToChips(params), [params]);
  
  // Convert chips → URL for persistence
  const setChips = useCallback((newChips: SearchChip[]) => {
    setParams(chipsToUrlParams(newChips));
  }, [setParams]);
  
  return { chips, setChips };
}
```

### nuqs: URL State (Already Installed!)

**You already have `nuqs`!** Use for shareable/bookmarkable filter state.

**Reference:** [nuqs documentation](https://nuqs.47ng.com/)

#### nuqs vs Zustand: When to Use Which

| State Type | Use nuqs | Use Zustand |
|------------|----------|-------------|
| **Filters** (status, search) | ✅ Shareable URL | ❌ |
| **Selected pool** | ✅ Deep-linkable | ❌ |
| **Sort column/direction** | ✅ Shareable | ❌ |
| **Column visibility** | ❌ | ✅ User preference |
| **Column order** | ❌ | ✅ User preference |
| **Column widths** | ❌ | ✅ User preference |
| **Compact mode** | ❌ | ✅ User preference |
| **Panel width** | ❌ | ✅ User preference |

**Rule of thumb:**
- **nuqs** = "I want to share this link with a colleague"
- **Zustand** = "I want the UI to remember my preferences"

#### Pools Page URL State

```tsx
// src/app/(dashboard)/pools/page.tsx
import {
  useQueryState,
  useQueryStates,
  parseAsString,
  parseAsStringEnum,
  parseAsArrayOf,
} from "nuqs";
import { PoolStatus } from "@/lib/api/generated";

// Define parsers once
const poolsSearchParams = {
  // Filter by status
  status: parseAsStringEnum<PoolStatus>(Object.values(PoolStatus)),
  
  // Filter by platforms (array)
  platforms: parseAsArrayOf(parseAsString).withDefault([]),
  
  // Text search
  q: parseAsString,
  
  // Sort
  sort: parseAsString.withDefault("name"),
  order: parseAsStringEnum(["asc", "desc"] as const).withDefault("asc"),
  
  // Selected pool (for deep-linking to panel)
  pool: parseAsString,
};

function PoolsPage() {
  // ✅ All URL state in one hook
  const [params, setParams] = useQueryStates(poolsSearchParams, {
    history: "push", // Enable back button
  });

  // Destructure for convenience
  const { status, platforms, q, sort, order, pool } = params;

  // Example: Filter by status
  const handleStatusFilter = (newStatus: PoolStatus | null) => {
    setParams({ status: newStatus });
  };

  // Example: Add platform filter
  const handleAddPlatform = (platform: string) => {
    setParams({ platforms: [...platforms, platform] });
  };

  // Example: Clear all filters
  const handleClearFilters = () => {
    setParams({ status: null, platforms: [], q: null });
  };

  // Example: Select pool (opens panel)
  const handleSelectPool = (poolName: string) => {
    setParams({ pool: poolName });
  };

  // URL examples:
  // /pools                                    → Default view
  // /pools?status=ONLINE                      → Only online pools
  // /pools?platforms=dgx,base                 → Filter by platforms
  // /pools?q=prod                             → Search for "prod"
  // /pools?sort=quota&order=desc              → Sort by quota descending
  // /pools?pool=my-pool                       → Panel open for "my-pool"
  // /pools?status=ONLINE&q=dev&pool=dev-pool  → Combined filters + panel
  
  return (/* ... */);
}
```

#### Sync nuqs with SmartSearch Chips

```tsx
// Convert URL params to search chips for display
function usePoolsSearchChips() {
  const [params, setParams] = useQueryStates(poolsSearchParams);
  
  const chips = useMemo(() => {
    const result: SearchChip[] = [];
    
    if (params.status) {
      result.push({
        field: "status",
        value: params.status,
        label: `Status: ${params.status}`,
      });
    }
    
    for (const platform of params.platforms) {
      result.push({
        field: "platform",
        value: platform,
        label: `Platform: ${platform}`,
      });
    }
    
    if (params.q) {
      result.push({
        field: "search",
        value: params.q,
        label: `"${params.q}"`,
      });
    }
    
    return result;
  }, [params]);

  const removeChip = useCallback((index: number) => {
    const chip = chips[index];
    if (chip.field === "status") {
      setParams({ status: null });
    } else if (chip.field === "platform") {
      setParams({ platforms: params.platforms.filter(p => p !== chip.value) });
    } else if (chip.field === "search") {
      setParams({ q: null });
    }
  }, [chips, params.platforms, setParams]);

  const clearAll = useCallback(() => {
    setParams({ status: null, platforms: [], q: null });
  }, [setParams]);

  return { chips, removeChip, clearAll };
}
```

#### Server Component Compatibility

nuqs works with Next.js App Router server components:

```tsx
// src/app/(dashboard)/pools/page.tsx
import { createSearchParamsCache } from "nuqs/server";

// Create cache for server components
const searchParamsCache = createSearchParamsCache(poolsSearchParams);

// Server component - can read URL params
export default async function PoolsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // Parse on server for SSR
  const params = searchParamsCache.parse(await searchParams);
  
  // Can use params.status, params.q, etc. for SSR filtering
  // Or pass to client component
  
  return <PoolsPageClient initialParams={params} />;
}
```

#### nuqs + Zustand Together

```tsx
// src/components/features/pools/hooks/use-pools-state.ts
import { useQueryStates } from "nuqs";
import { useShallow } from "zustand/react/shallow";
import { usePoolsTableStore } from "../stores/pools-table-store";

/**
 * Combines nuqs (URL state) with Zustand (user preferences).
 * 
 * URL state (nuqs): Shareable filters, sort, selected pool
 * Zustand state: Column visibility, widths, compact mode, panel width
 */
export function usePoolsState() {
  // URL state - shareable
  const [urlState, setUrlState] = useQueryStates(poolsSearchParams, {
    history: "push",
  });

  // User preferences - persisted locally
  const preferences = usePoolsTableStore(
    useShallow((s) => ({
      visibleColumnIds: s.visibleColumnIds,
      columnOrder: s.columnOrder,
      columnUserWidths: s.columnUserWidths,
      compactMode: s.compactMode,
      panelWidth: s.panelWidth,
    }))
  );

  const preferenceActions = usePoolsTableStore(
    useShallow((s) => ({
      toggleColumn: s.toggleColumn,
      setColumnOrder: s.setColumnOrder,
      toggleCompactMode: s.toggleCompactMode,
      setPanelWidth: s.setPanelWidth,
    }))
  );

  return {
    // URL state (shareable)
    filters: {
      status: urlState.status,
      platforms: urlState.platforms,
      search: urlState.q,
    },
    sort: {
      column: urlState.sort,
      direction: urlState.order,
    },
    selectedPool: urlState.pool,
    setFilters: (f: Partial<typeof urlState>) => setUrlState(f),
    setSort: (column: string, direction: "asc" | "desc") => 
      setUrlState({ sort: column, order: direction }),
    selectPool: (name: string | null) => setUrlState({ pool: name }),
    
    // User preferences (local)
    preferences,
    preferenceActions,
  };
}
```

#### Benefits of nuqs for Pools Page

| Benefit | Example |
|---------|---------|
| **Shareable Links** | "Check out these offline pools" → `/pools?status=OFFLINE` |
| **Bookmarkable Views** | Bookmark "My production pools" → `/pools?q=prod&status=ONLINE` |
| **Back Button Works** | Navigate filters, press back → previous filter state |
| **Deep-link to Panel** | "See this pool" → `/pools?pool=isaac-hil` opens panel |
| **SSR Support** | Server can pre-filter based on URL for faster initial render |
| **Refresh Preserves State** | Refresh page → same filters, same panel |

### Radix Primitives: More to Install

```bash
pnpm add @radix-ui/react-collapsible @radix-ui/react-progress @radix-ui/react-scroll-area @radix-ui/react-separator
```

Then use shadcn CLI to add components:

```bash
npx shadcn@latest add collapsible progress scroll-area separator
```

**Use for:**

```tsx
// ✅ Collapsible sections (instead of custom)
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";

<Collapsible open={!isCollapsed} onOpenChange={toggle}>
  <CollapsibleTrigger>🟢 Online ({count})</CollapsibleTrigger>
  <CollapsibleContent>
    {pools.map(pool => <PoolRow key={pool.name} pool={pool} />)}
  </CollapsibleContent>
</Collapsible>

// ✅ Progress bars (instead of custom)
import { Progress } from "@/components/ui/progress";

<Progress value={(quota.used / quota.limit) * 100} />

// ✅ Scroll area with custom scrollbar (instead of custom CSS)
import { ScrollArea } from "@/components/ui/scroll-area";

<ScrollArea className="h-[400px]">
  {items.map(item => <Item key={item.id} />)}
</ScrollArea>
```

### react-resizable-panels: Panel Resizing

**Consider adding** for production-quality panel resizing:

```bash
pnpm add react-resizable-panels
```

```tsx
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";

// ✅ Zero custom resize logic
function PoolsLayout() {
  return (
    <PanelGroup direction="horizontal" autoSaveId="pools-layout">
      {/* Main content */}
      <Panel defaultSize={60} minSize={30}>
        <PoolsTable />
      </Panel>
      
      {/* Resize handle */}
      <PanelResizeHandle className="w-1 bg-gray-200 hover:bg-blue-500" />
      
      {/* Details panel */}
      <Panel defaultSize={40} minSize={20}>
        <PoolDetailsPanel />
      </Panel>
    </PanelGroup>
  );
}
```

**Benefits over custom:**
- Built-in keyboard support
- Built-in persistence (`autoSaveId`)
- Built-in min/max constraints
- Accessible (ARIA compliant)
- Battle-tested

### Revised Component Strategy

| Component | Before (Custom) | After (Library) |
|-----------|-----------------|-----------------|
| Omni Search | Custom chips, autocomplete | **cmdk** inline mode (already installed) |
| Column Sorting | Custom state | **TanStack Table** `getSortedRowModel` |
| Column Visibility | Custom state | **TanStack Table** `columnVisibility` |
| Column Resizing | Custom drag logic | **TanStack Table** `columnResizeMode` |
| Column Ordering | Custom @dnd-kit | **@dnd-kit** (keep, TanStack ordering is limited) |
| Virtualization | Custom hook | **@tanstack/react-virtual** (already using) |
| Panel Resizing | Custom hook | **react-resizable-panels** (add) |
| Collapsible Sections | Custom state | **Radix Collapsible** (add) |
| Progress Bars | Custom div | **Radix Progress** (add) |
| URL State | localStorage only | **nuqs** (already installed) |
| Store Persistence | Custom | **Zustand persist** (already included) |

### Code We Still Need to Write

**Minimal custom code required:**

| What | Why Custom |
|------|------------|
| Pool column definitions | Business-specific cell rendering |
| Search field definitions | Business-specific filter logic |
| GPU progress cell | Custom dual-bar visualization |
| Platform pills | Custom responsive expansion |
| Pool-specific transforms | Backend adapter layer |
| Headless hook composition | Combines library outputs |

### Updated Dependencies

```bash
# Add these for maximum library leverage
pnpm add react-resizable-panels
pnpm add @radix-ui/react-collapsible @radix-ui/react-progress @radix-ui/react-scroll-area

# Then add shadcn components
npx shadcn@latest add collapsible progress scroll-area
```

### Summary: Lines of Code Saved

| Feature | Custom LOC | Library LOC | Savings |
|---------|------------|-------------|---------|
| Column sorting | ~80 | ~10 | **-70** |
| Column visibility | ~60 | ~10 | **-50** |
| Column resizing | ~150 | ~20 | **-130** |
| Smart search | ~200 | ~50 | **-150** |
| Panel resizing | ~100 | ~15 | **-85** |
| Collapsible sections | ~40 | ~10 | **-30** |
| Progress bars | ~30 | ~5 | **-25** |
| URL state | ~60 | ~10 | **-50** |
| **TOTAL** | **~720** | **~130** | **~590 LOC saved** |

---

## Implementation Checklist

### Phase 0: Read Architecture & Best Practices ⚠️

- [ ] **READ [Codebase Architecture & Patterns](#codebase-architecture--patterns)** — Mandatory
  - [ ] Understand three-layer architecture (UI → Headless → Adapter → Generated)
  - [ ] Understand import rules (what to import from where)
  - [ ] Understand headless hooks pattern (behavior without styling)
  - [ ] Understand adapter pattern (backend workarounds quarantined)
  - [ ] Understand BACKEND_TODOS.md documentation pattern
- [ ] **READ [Best Practices & Performance Optimizations](#best-practices--performance-optimizations)** — Mandatory
  - [ ] Understand CSS data-attribute pattern for status styling
  - [ ] Understand CSS containment classes
  - [ ] Understand Context pattern for stable callbacks
  - [ ] Understand memoization patterns
  - [ ] Understand pre-computed lookup maps

### Phase 1: Install Dependencies & Shadcn Components

```bash
# Core state management
pnpm add immer

# Panel resizing (saves ~100 LOC)
pnpm add react-resizable-panels

# Radix primitives
pnpm add @radix-ui/react-collapsible @radix-ui/react-progress @radix-ui/react-scroll-area

# Shadcn components (wraps Radix with styling)
npx shadcn@latest add collapsible progress scroll-area
```

- [ ] Run install commands above
- [ ] Verify `command.tsx` exists (for cmdk/smart search)
- [ ] Verify TanStack Table, nuqs, zustand already installed

**Generic Store Factory:**
- [ ] Create `src/lib/stores/index.ts` (barrel exports)
- [ ] Create `src/lib/stores/types.ts` (shared store types)
- [ ] Create `src/lib/stores/create-table-store.ts` (factory with persist + immer)

**DataTable Wrapper (Thin wrapper around TanStack Table):**
- [ ] Create `src/components/ui/data-table/types.ts` (extend TanStack types)
- [ ] Create `src/components/ui/data-table/DataTable.tsx` (TanStack + @dnd-kit + virtualization)
- [ ] Create `src/components/ui/data-table/index.ts`
- [ ] Note: Most logic comes from TanStack Table, we just compose

**OmniSearch (Uses cmdk/Command in INLINE mode):**
- [ ] Create `src/components/ui/smart-search/types.ts` (SearchField, SearchChip)
- [ ] Create `src/components/ui/smart-search/SmartSearch.tsx` (inline Command + chips + dropdown)
- [ ] Create `src/components/ui/smart-search/index.ts`
- [ ] Note: Uses Command inline (NOT CommandDialog modal), chips displayed in input row

### Phase 2: Pools-Specific Composition

- [ ] Create `src/components/features/pools/pools.css` with CSS custom properties
- [ ] Create `src/components/features/pools/constants.ts` with pre-computed maps
- [ ] Create `src/components/features/pools/context.tsx` with stable callbacks
- [ ] Create `src/components/features/pools/stores/pools-table-store.ts` using factory
- [ ] Create `src/components/features/pools/stores/selectors.ts` with reusable selectors
- [ ] Create `src/components/features/pools/pool-columns.ts` (column definitions)
- [ ] Create `src/components/features/pools/pool-search-fields.ts` (search fields)
- [ ] Update `src/lib/api/adapter/types.ts` with `sharingGroups`
- [ ] Update `src/lib/api/adapter/transforms.ts` with sharing transform

### Phase 3: Pools Components (Business-Specific Only)

- [ ] Create `src/components/features/pools/GpuProgressCell.tsx` (uses Radix Progress)
- [ ] Create `src/components/features/pools/PlatformPills.tsx` (custom, responsive expansion)
- [ ] Create `src/components/features/pools/PoolRow.tsx` (memoized cell renderers)
- [ ] Create `src/components/features/pools/PoolsTable.tsx` (composes: TanStack Table + DataTable wrapper + SmartSearch)
- [ ] Create `src/components/features/pools/PoolsLayout.tsx` (uses react-resizable-panels)
- [ ] Create `src/components/features/pools/PoolPanel.tsx` (details content only)

### Phase 4: Page Integration

- [ ] Rewrite `src/app/(dashboard)/pools/page.tsx` to use new PoolsTable
- [ ] Test all user journeys
- [ ] Test persistence (refresh page, check localStorage)
- [ ] Test keyboard navigation
- [ ] Test panel resize + snap presets
- [ ] Test column resize (wider/narrower/reset)

### Phase 5: Polish & Verification

- [ ] Verify compact mode
- [ ] Verify platform pills responsiveness
- [ ] Verify sharing tooltip
- [ ] Verify dual-mode column resize behavior
- [ ] Performance check with many pools (100+)
- [ ] **Light/Dark Mode Testing:**
  - [ ] Toggle theme in UI, verify every component
  - [ ] Check table header (light: zinc-100, dark: zinc-800)
  - [ ] Check table rows (hover states in both modes)
  - [ ] Check selected row (light: blue-50, dark: blue-950/30)
  - [ ] Check status badges (all 3 statuses in both modes)
  - [ ] Check progress bars (visible track in both modes)
  - [ ] Check panel (border, shadow, header visible)
  - [ ] Check resize handle (visible on hover in both modes)
  - [ ] Check search chips (visible in both modes)
  - [ ] Check collapsible section chevrons (visible in both modes)
  - [ ] NO white boxes in dark mode, NO dark text on dark bg

### Phase 6: Architecture & Best Practices Audit

**Reusability Compliance:**
- [ ] **SmartSearch**: Lives in `src/components/ui/smart-search/`, NOT in pools feature
- [ ] **SmartSearch**: Works with any data type via generics `<T>`
- [ ] **SmartSearch**: Pool-specific fields defined in `pool-search-fields.ts`
- [ ] **DataTable**: Lives in `src/components/ui/data-table/`, NOT in pools feature
- [ ] **DataTable**: Works with any data type via generics `<T>`
- [ ] **DataTable**: Pool-specific columns defined in `pool-columns.ts`
- [ ] **ResizablePanel**: Lives in `src/components/ui/resizable-panel/`
- [ ] **Store Factory**: Lives in `src/lib/stores/create-table-store.ts`
- [ ] **Store Factory**: Pool store uses factory, NOT copy-paste
- [ ] **No Pools Logic in ui/**: `ui/` components have ZERO pools-specific code

**Architecture Compliance:**
- [ ] **Layers**: UI components have NO business logic (only styling)
- [ ] **Layers**: All business logic lives in headless hooks
- [ ] **Layers**: All backend workarounds are in adapter layer (not scattered)
- [ ] **Imports**: UI imports from `@/lib/api/adapter`, not `@/lib/api/generated`
- [ ] **Imports**: Only enums imported directly from generated.ts
- [ ] **Headless**: New hook follows `use-pools-list.ts` pattern
- [ ] **Headless**: Hook is exported from `src/headless/index.ts`
- [ ] **Transforms**: Any new backend transforms are in `adapter/transforms.ts`
- [ ] **BACKEND_TODOS**: Any new backend issues are documented

**Layer Isolation Compliance:**
- [ ] **UI → Headless**: No `.filter()` or `.sort()` in UI components
- [ ] **UI → Headless**: No `useMemo` for derived data in UI (only for render perf)
- [ ] **Headless → Adapter**: No imports from `generated.ts` in headless (use adapter)
- [ ] **Headless → Adapter**: No type casting of API responses in headless
- [ ] **Headless → UI**: No JSX or `className` in headless hooks
- [ ] **Adapter → Headless**: No `.filter()` or business conditions in adapter
- [ ] **Adapter → Headless**: No `useState` or stateful logic in adapter
- [ ] **Adapter Only**: All `parseNumber()`, unit conversions, type casts in adapter

**Zustand Store Compliance:**
- [ ] **Store Factory**: Uses `createTableStore()` factory, not copy-paste
- [ ] **Store Location**: Feature store in `features/pools/stores/`, factory in `lib/stores/`
- [ ] **Selectors**: UI uses selectors `(s) => s.field`, not entire store
- [ ] **Shallow**: Multiple fields selected with `useShallow()`
- [ ] **No API Data**: Store holds UI preferences only, not API data (use React Query)
- [ ] **No Business Logic**: Store holds config (sort column), not results (sorted list)
- [ ] **Persist Middleware**: `persist()` used with `partialize` for selective persistence
- [ ] **Immer Middleware**: `immer()` used for safe mutations
- [ ] **Ephemeral Excluded**: `searchChips` excluded from persistence via `partialize`
- [ ] **Version Migration**: `migrate` function handles version upgrades

**Library Maximization Compliance:**
- [ ] **TanStack Table**: Using built-in `getSortedRowModel`, NOT custom sort
- [ ] **TanStack Table**: Using built-in `columnVisibility`, NOT custom state
- [ ] **TanStack Table**: Using built-in `columnResizeMode`, NOT custom drag
- [ ] **cmdk**: OmniSearch uses `Command` inline (NOT modal), with chips + dropdown
- [ ] **nuqs**: URL state for shareable filters, NOT just localStorage
- [ ] **react-resizable-panels**: Panel resizing, NOT custom mouse handlers
- [ ] **Radix Collapsible**: Section collapse, NOT custom toggle
- [ ] **Radix Progress**: GPU bars, NOT custom div styling
- [ ] **No Reinvention**: Checked library docs before writing custom code

**Styling Compliance:**
- [ ] **styles.ts**: Using `card`, `section`, `heading`, `text`, `chip`, `badge` from `src/lib/styles.ts`
- [ ] **cn()**: All conditional classes use `cn()` from `src/lib/utils`
- [ ] **Zinc Palette**: Neutrals use zinc (not gray) for consistency
- [ ] **Status Colors**: Online=emerald, Maintenance=amber, Offline=red (matches DAG)
- [ ] **Table Styling**: Matches DAG TaskTable patterns
- [ ] **Panel Styling**: Matches DAG DetailsPanel patterns
- [ ] **Progress Bars**: Uses `progressTrack` and `getProgressColor()`
- [ ] **CSS File**: Created `pools.css` with custom properties (like `dag.css`)
- [ ] **Data Attributes**: Status styling via `[data-status]`, not JS classNames

**Light/Dark Mode Compliance (CRITICAL):**
- [ ] **bg-***: Every `bg-*` class has a corresponding `dark:bg-*` variant
- [ ] **text-***: Every `text-*` class has a corresponding `dark:text-*` variant
- [ ] **border-***: Every `border-*` class has a corresponding `dark:border-*` variant
- [ ] **divide-***: Every `divide-*` class has a corresponding `dark:divide-*` variant
- [ ] **ring-***: Every `ring-*` class has a corresponding `dark:ring-*` variant
- [ ] **hover:***: Every `hover:*` state has a `dark:hover:*` equivalent
- [ ] **focus:***: Focus rings visible in both modes (`dark:focus:ring-*`)
- [ ] **Shadows**: Adjusted opacity for dark mode (light: 0.1, dark: 0.3-0.4)
- [ ] **CSS Vars**: All custom properties have `.dark {}` overrides
- [ ] **Visual Test**: Manually toggled theme and verified EVERY component

**Best Practices Compliance:**
- [ ] **CSS**: All status styling uses `data-status` attributes, not JS classNames
- [ ] **CSS**: All virtualized items have `contain: strict` applied
- [ ] **CSS**: Reduced motion media query disables animations
- [ ] **Components**: Row components are memoized with custom comparison
- [ ] **Components**: Callbacks are provided via Context (not props)
- [ ] **State**: Lookup maps are pre-computed, not using `.find()` in render
- [ ] **State**: Derived data computed in single pass
- [ ] **State**: Grid template uses caching
- [ ] **Accessibility**: Skip link present
- [ ] **Accessibility**: ARIA roles and labels on table elements
- [ ] **Accessibility**: Keyboard navigation works (Enter/Space to select)
- [ ] **Error Handling**: Error boundary wraps the table
- [ ] **Code Quality**: DocBlock comments on every file
- [ ] **Code Quality**: Barrel exports in index.ts files

---

## Resolved Questions

| Question | Decision |
|----------|----------|
| Panel width | **Resolved:** Overlay panel, resizable 25-80%, snap presets (33%, 50%, 75%), persisted |
| Column resize + shares | **Resolved:** Dual-mode (wider=new min, narrower=fixed), double-click to reset |
| TanStack Table | **Resolved:** Use for sorting, filtering, column resize; custom rendering for UX |

---

## Appendix: Visual Reference

### Current → Proposed

**Current:**
```
┌─────────────────────────────────────────────────────────────────┐
│ [Search pools...]                                               │
├─────────────────────────────────────────────────────────────────┤
├─────────────────────────────────────────────────────────────────┤
│ ▼ 🟢 Online (5)                                                 │
│ ┌─────────────────────────────────────────────────────────────┐ │
│ │ pool-prod   Production     ████░░ 8/12 GPU    4 available   │ │
│ │ pool-stage  Staging        ████░░ 6/10 GPU    4 available   │ │
│ └─────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

**Proposed:**
```
┌──────────────────────────────────────────────────────────────────────────────────────┐
│ [🔍 status:ONLINE] [platform:arm64]              [× clear]   [used ⟷ free] [compact] │
├──────────────────────────────────────────────────────────────────────────────────────┤
│ POOL ▴       ↔│ DESCRIPTION     ↔│ QUOTA (GPU) ▼↔│ CAPACITY (GPU)↔│ PLATFORMS↔│BACKEND│
╞══════════════════════════════════════════════════════════════════════════════════════╡
│ ⭐🟢 pool-dev │ Development      │ ██░░░░ 80 free│ ███░░░░ 120 idl│[arm64]+2 │ k8s   │
├──────────────────────────────────────────────────────────────────────────────────────┤
│ ▼ 🟢 Online (3)                                                                       │
├──────────────────────────────────────────────────────────────────────────────────────┤
│ pool-staging  │ Staging env      │ █████░ 50 free│ █████░░ 80 idle│[x86]+1   │ k8s   │
│ pool-prod     │ Production       │ ████████20 fre│ ███████ 20 idle│[arm][x86]│ k8s   │
│ pool-batch    │ Batch processing │ ██████████ 0  │ █████████ 10 🔗│[x86]+3   │ k8s   │
├──────────────────────────────────────────────────────────────────────────────────────┤
│ ▶ 🔧 Maintenance (1)                                                    [collapsed]  │
└──────────────────────────────────────────────────────────────────────────────────────┘

(↔ = resize handles on column edges)
(Empty sections like "Offline (0)" are hidden completely)
```
