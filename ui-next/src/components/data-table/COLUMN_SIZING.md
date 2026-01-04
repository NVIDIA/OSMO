<!--
Copyright (c) 2026, NVIDIA CORPORATION. All rights reserved.

NVIDIA CORPORATION and its licensors retain all intellectual property
and proprietary rights in and to this software, related documentation
and any modifications thereto. Any use, reproduction, disclosure or
distribution of this software and related documentation without an express
license agreement from NVIDIA CORPORATION is strictly prohibited.
-->

# Column Sizing Design Document

## Overview

A high-performance column sizing system for the `DataTable` component that provides:
- Proportional column sizing with share-based distribution
- Manual column resize with persistence
- Auto-fit (double-click) to content width
- Content-based maximum widths (auto-tracked)
- Buttery-smooth 60fps interactions

## Goals

1. **Zero React re-renders during drag** - DOM manipulation only
2. **Stable callbacks** - Follow patterns from `CALLBACK_STABILITY.md`
3. **DRY implementation** - Reusable utilities and hooks
4. **Accessible** - Works with keyboard (future enhancement)
5. **Persistent** - User preferences saved to Zustand store

## User Interactions

| Action | Result |
|--------|--------|
| **Drag resize handle** | Column becomes fixed at dragged width |
| **Double-click resize handle** | Auto-fit to visible content (becomes fixed) |
| **Shift + double-click** | Reset column to proportional |
| **Drag below minimum** | Clamped at `minWidth` |
| **Drag beyond container** | Whitespace consumed first, then horizontal scroll |

## Column Types

### Proportional (Default)

Columns share available space based on their `share` ratio. They expand/contract when the container resizes, but never exceed their `naturalWidth` (widest content seen).

### Fixed (After Manual Resize)

Columns stay at an exact pixel width regardless of container size. Created when user drags a resize handle or double-clicks to auto-fit.

## Configuration Schema

```typescript
interface ColumnSizeConfig {
  /** Column identifier (matches column.id) */
  id: string;
  
  /** Minimum width in pixels - cannot resize below this */
  minWidth: number;
  
  /** Proportional share for space distribution (like flex ratio) */
  share: number;
}

// Example configuration
const RESOURCE_COLUMNS: ColumnSizeConfig[] = [
  { id: "resource",  minWidth: 140, share: 3 },
  { id: "type",      minWidth: 80,  share: 1 },
  { id: "pool",      minWidth: 120, share: 2 },
  { id: "gpu",       minWidth: 80,  share: 1 },
  { id: "allocated", minWidth: 100, share: 2 },
  { id: "reserved",  minWidth: 100, share: 2 },
];
```

## State Model

```typescript
interface ColumnSizingState {
  /**
   * Columns with manual/fixed widths.
   * Columns not in this map use proportional sizing.
   */
  manualWidths: Record<string, number>;
  
  /**
   * Widest content ever seen per column.
   * Used as maximum for proportional expansion.
   * Updated silently when scrolling reveals wider content.
   */
  naturalWidths: Record<string, number>;
  
  /**
   * Computed pixel widths for all columns.
   * Recalculated when container resizes or manualWidths change.
   */
  computedWidths: Record<string, number>;
}
```

## Space Distribution Algorithm

```typescript
function calculateColumnWidths(
  columns: ColumnSizeConfig[],
  containerWidth: number,
  manualWidths: Record<string, number>,
  naturalWidths: Record<string, number>,
): Record<string, number> {
  // 1. Separate fixed (manual) and proportional columns
  const fixedCols = columns.filter(c => manualWidths[c.id] != null);
  const flexCols = columns.filter(c => manualWidths[c.id] == null);
  
  // 2. Fixed columns use their manual width (clamped to min)
  const widths: Record<string, number> = {};
  let fixedTotal = 0;
  
  for (const col of fixedCols) {
    const width = Math.max(manualWidths[col.id], col.minWidth);
    widths[col.id] = width;
    fixedTotal += width;
  }
  
  // 3. Remaining space for proportional columns
  let remainingSpace = containerWidth - fixedTotal;
  const totalMinWidth = flexCols.reduce((sum, c) => sum + c.minWidth, 0);
  
  // 4. If not enough space, all at minimum (will scroll)
  if (remainingSpace <= totalMinWidth) {
    for (const col of flexCols) {
      widths[col.id] = col.minWidth;
    }
    return widths;
  }
  
  // 5. Distribute extra space by share, capping at naturalWidth
  const extraSpace = remainingSpace - totalMinWidth;
  const totalShares = flexCols.reduce((sum, c) => sum + c.share, 0);
  
  // Iterative distribution (handles cap cascading)
  let distributed = 0;
  const remaining = [...flexCols];
  
  for (const col of flexCols) {
    widths[col.id] = col.minWidth;
  }
  
  for (let i = 0; i < 10 && remaining.length > 0; i++) {
    const activeShares = remaining.reduce((sum, c) => sum + c.share, 0);
    const spaceToDistribute = extraSpace - distributed;
    
    const capped: string[] = [];
    
    for (const col of remaining) {
      const allocation = (spaceToDistribute * col.share) / activeShares;
      const maxWidth = naturalWidths[col.id] ?? Infinity;
      const targetWidth = widths[col.id] + allocation;
      
      if (targetWidth >= maxWidth) {
        // Cap at natural width
        const growth = maxWidth - widths[col.id];
        widths[col.id] = maxWidth;
        distributed += growth;
        capped.push(col.id);
      } else {
        widths[col.id] = targetWidth;
        distributed += allocation;
      }
    }
    
    // Remove capped columns from next iteration
    remaining.splice(0, remaining.length, ...remaining.filter(c => !capped.includes(c.id)));
    
    if (capped.length === 0) break; // Nothing capped, done
  }
  
  return widths;
}
```

## Architecture

```
@/components/data-table/
├── hooks/
│   ├── use-column-sizing.ts     # Main hook: sizing logic + ResizeObserver
│   ├── use-column-resize.ts     # Drag resize handler (PointerEvents)
│   └── use-content-measurement.ts # Measure visible cell widths
├── components/
│   └── ResizeHandle.tsx         # Draggable resize handle
├── utils/
│   └── column-sizing.ts         # Pure calculation functions
├── types.ts                     # Add ColumnSizeConfig, ColumnSizingState
└── styles.css                   # Add resize handle styles
```

## Performance Techniques

### 1. CSS Custom Properties (Zero Re-renders During Drag)

Column widths are CSS variables on the table element. During drag, we update the variable directly without React.

```tsx
// Table element with CSS variables
<table style={{ 
  '--col-resource': `${widths.resource}px`,
  '--col-type': `${widths.type}px`,
  // ...
} as React.CSSProperties}>

// Cells read from CSS variables
<th style={{ width: 'var(--col-resource)' }}>
<td style={{ width: 'var(--col-resource)' }}>

// During drag (direct DOM, no React):
tableRef.current.style.setProperty('--col-resource', `${newWidth}px`);
```

### 2. Pointer Events API + Scroll Prevention

Native PointerEvents with pointer capture for smooth drag handling.
**Critical**: Prevent scrolling during resize to avoid accidental content movement.

```tsx
const handlePointerDown = (e: React.PointerEvent) => {
  e.preventDefault(); // Prevent text selection
  e.stopPropagation(); // Don't bubble to scroll container
  e.currentTarget.setPointerCapture(e.pointerId);
  
  dragStartRef.current = { x: e.clientX, startWidth };
  
  // Prevent scrolling during resize
  scrollContainerRef.current?.classList.add('is-resizing');
};

const handlePointerMove = (e: React.PointerEvent) => {
  if (!dragStartRef.current) return;
  e.preventDefault(); // Prevent any scroll behavior
  
  const delta = e.clientX - dragStartRef.current.x;
  const newWidth = Math.max(minWidth, dragStartRef.current.startWidth + delta);
  
  // Direct DOM update - no React
  tableRef.current?.style.setProperty(`--col-${columnId}`, `${newWidth}px`);
};

const handlePointerUp = (e: React.PointerEvent) => {
  e.currentTarget.releasePointerCapture(e.pointerId);
  
  // Re-enable scrolling
  scrollContainerRef.current?.classList.remove('is-resizing');
  
  // NOW commit to React state
  setManualWidths(prev => ({ ...prev, [columnId]: newWidth }));
};
```

### 3. Refs for Drag State (Avoid Re-renders)

All drag state lives in refs. React state only updated on release.

```tsx
const dragStateRef = useRef<{
  columnId: string;
  startX: number;
  startWidth: number;
} | null>(null);
```

### 4. ResizeObserver for Container

Efficient container size detection without polling.

```tsx
useEffect(() => {
  const observer = new ResizeObserver(([entry]) => {
    recalculateWidths(entry.contentRect.width);
  });
  observer.observe(containerRef.current);
  return () => observer.disconnect();
}, []);
```

### 5. CSS Containment

Isolate layout recalculations to the table.

```css
.data-table {
  contain: layout style;
}

.data-table th,
.data-table td {
  contain: inline-size;
}
```

### 6. will-change During Drag

GPU acceleration hint during active resize.

```tsx
// On drag start
document.body.style.cursor = 'col-resize';
columnElement.style.willChange = 'width';

// On drag end
document.body.style.cursor = '';
columnElement.style.willChange = '';
```

### 7. startTransition for Persistence

Defer storage writes to avoid blocking UI.

```tsx
import { startTransition } from 'react';

const onDragEnd = (newWidth: number) => {
  // High priority: update width
  setManualWidths(prev => ({ ...prev, [columnId]: newWidth }));
  
  // Low priority: persist
  startTransition(() => {
    store.persist();
  });
};
```

## Stable Callback Patterns

Following `CALLBACK_STABILITY.md`:

```tsx
// ❌ BAD: callback changes when widths change
const handleResize = useCallback(
  (columnId, width) => setWidths({ ...widths, [columnId]: width }),
  [widths], // New function every time widths changes
);

// ✅ GOOD: callback is stable, reads from ref
const widthsRef = useRef(widths);
widthsRef.current = widths;

const handleResize = useCallback(
  (columnId: string, width: number) => {
    setWidths(prev => ({ ...prev, [columnId]: width }));
  },
  [], // Stable - no dependencies
);
```

## Content Measurement

### Visible Cells Only (Best Effort)

```tsx
function measureColumnWidth(
  columnId: string,
  tableElement: HTMLTableElement,
  padding: number = 32,
): number {
  const cells = tableElement.querySelectorAll(`[data-column-id="${columnId}"]`);
  
  let maxWidth = 0;
  cells.forEach(cell => {
    maxWidth = Math.max(maxWidth, cell.scrollWidth);
  });
  
  return maxWidth + padding;
}
```

### Track Widest Seen

```tsx
// In useVirtualizedTable or parent component
useEffect(() => {
  const measured = measureVisibleColumns(tableRef.current);
  
  setNaturalWidths(prev => {
    const next = { ...prev };
    for (const [id, width] of Object.entries(measured)) {
      next[id] = Math.max(prev[id] ?? 0, width);
    }
    return next;
  });
}, [virtualRows]); // When visible rows change
```

## Persistence

Integrate with existing preference stores:

```tsx
// In resources-preferences-store.ts
interface ResourcesPreferencesState {
  // ... existing
  columnManualWidths: Record<string, number>;
}

// Actions
setColumnWidth: (columnId: string, width: number) => void;
resetColumnWidth: (columnId: string) => void;
resetAllColumnWidths: () => void;
```

## Component Integration

### DataTable Props Addition

```typescript
interface DataTableProps<TData> {
  // ... existing props
  
  /** Column size configuration */
  columnSizeConfig?: ColumnSizeConfig[];
  
  /** Manual column widths (controlled) */
  columnManualWidths?: Record<string, number>;
  
  /** Manual width change handler */
  onColumnManualWidthChange?: (columnId: string, width: number) => void;
  
  /** Reset column width handler */
  onColumnWidthReset?: (columnId: string) => void;
  
  /** Enable column resizing */
  enableColumnResizing?: boolean;
}
```

### ResizeHandle Component

```tsx
interface ResizeHandleProps {
  columnId: string;
  scrollContainerRef: React.RefObject<HTMLElement | null>;
  onResizeStart: (columnId: string) => void;
  onResize: (columnId: string, delta: number) => void;
  onResizeEnd: (columnId: string, finalWidth: number) => void;
  onAutoFit: (columnId: string) => void;
  onReset: (columnId: string) => void;
}

function ResizeHandle({
  columnId,
  scrollContainerRef,
  onResizeStart,
  onResize,
  onResizeEnd,
  onAutoFit,
  onReset,
}: ResizeHandleProps) {
  const handlePointerDown = (e: React.PointerEvent) => {
    // Prevent default behavior and stop propagation
    e.preventDefault();
    e.stopPropagation();
    
    // Capture all pointer events to this element
    e.currentTarget.setPointerCapture(e.pointerId);
    
    // CRITICAL: Lock scrolling during resize
    scrollContainerRef.current?.classList.add('is-resizing');
    document.body.style.cursor = 'col-resize';
    
    onResizeStart(columnId);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
    
    // Prevent any scroll behavior
    e.preventDefault();
    
    // Use movementX for delta (more reliable than tracking startX)
    onResize(columnId, e.movementX);
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    e.currentTarget.releasePointerCapture(e.pointerId);
    
    // CRITICAL: Unlock scrolling
    scrollContainerRef.current?.classList.remove('is-resizing');
    document.body.style.cursor = '';
    
    // Get final width from DOM
    const th = e.currentTarget.closest('th');
    onResizeEnd(columnId, th?.offsetWidth ?? 0);
  };

  // Also handle pointer cancel (e.g., touch interrupted)
  const handlePointerCancel = (e: React.PointerEvent) => {
    scrollContainerRef.current?.classList.remove('is-resizing');
    document.body.style.cursor = '';
  };

  const handleDoubleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    
    if (e.shiftKey) {
      onReset(columnId);
    } else {
      onAutoFit(columnId);
    }
  };

  return (
    <div
      className="resize-handle"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onDoubleClick={handleDoubleClick}
      role="separator"
      aria-orientation="vertical"
      aria-label={`Resize ${columnId} column`}
      tabIndex={-1} // Prevent focus (handled by column header)
    />
  );
}
```

## CSS Styles

```css
/* Resize handle */
.resize-handle {
  position: absolute;
  right: 0;
  top: 0;
  bottom: 0;
  width: 8px;
  cursor: col-resize;
  user-select: none;
  touch-action: none; /* Prevent touch scroll/gestures */
  z-index: 1;
}

.resize-handle::after {
  content: '';
  position: absolute;
  right: 3px;
  top: 25%;
  bottom: 25%;
  width: 2px;
  background: transparent;
  border-radius: 1px;
  transition: background-color 150ms;
}

.resize-handle:hover::after,
.resize-handle:active::after {
  background: var(--color-zinc-400);
}

/* During active resize */
.resize-handle:active {
  background: var(--color-zinc-200);
}

/* Header cell needs relative positioning */
.data-table th {
  position: relative;
}

/* ============================================
   CRITICAL: Scroll prevention during resize
   ============================================ */

/* Applied to scroll container during resize */
.is-resizing {
  /* Prevent all scrolling during resize */
  overflow: hidden !important;
  
  /* Prevent overscroll behavior */
  overscroll-behavior: none;
  
  /* Prevent text selection */
  user-select: none;
  
  /* Prevent touch actions */
  touch-action: none;
}

/* Force col-resize cursor everywhere during resize */
.is-resizing,
.is-resizing * {
  cursor: col-resize !important;
}

/* Prevent pointer events on table content during resize */
.is-resizing .data-table tbody {
  pointer-events: none;
}
```

### Scroll Prevention Strategy

During column resize, we prevent scrolling via multiple layers:

| Technique | Purpose |
|-----------|---------|
| `touch-action: none` on handle | Prevent touch scroll/pan gestures |
| `e.preventDefault()` on pointer events | Prevent default scroll behavior |
| `e.stopPropagation()` | Don't bubble to scroll container |
| `overflow: hidden` on container | CSS-level scroll lock |
| `pointer-events: none` on tbody | Prevent accidental row interactions |
| Pointer capture | All events go to resize handle |

### DnD Column Reorder Constraints

During column drag-and-drop reordering, we constrain movement to prevent continuous table expansion:

| Constraint | Purpose |
|------------|---------|
| `restrictToHorizontalAxis` | Only allow horizontal movement |
| `restrictToParentElement` | Keep drag within table header bounds |
| No auto-scroll | Don't scroll table when dragging near edges |
| Fixed table width | Table width doesn't change during DnD |
| **Fixed columns immovable** | First/primary columns cannot be reordered |

### Fixed (Non-Draggable) Columns

Columns in the `fixedColumns` array are pinned to the left side for **reordering only**:

| Feature | Fixed Column | Regular Column |
|---------|--------------|----------------|
| **Reorder (DnD)** | ❌ Cannot drag or be displaced | ✅ Can drag and reorder |
| **Resize** | ✅ Can resize | ✅ Can resize |
| **Sort** | ✅ Can sort | ✅ Can sort |
| **Auto-fit** | ✅ Double-click to fit | ✅ Double-click to fit |
| **Position** | Always at start | Can be moved |

**Key distinction**: "Fixed" refers to **position/order**, not **width**. Fixed columns are fully resizable.

```tsx
// DataTable props
<DataTable
  fixedColumns={["resource"]} // Primary column stays first
  // ...
/>

// In handleDragEnd - reject drops before fixed columns
const firstMovableIndex = columnOrder.findIndex(
  (id) => !fixedColumns.includes(id),
);
if (newIndex < firstMovableIndex) {
  return; // Reject this drop
}
```

```tsx
import { 
  restrictToHorizontalAxis, 
  restrictToParentElement 
} from '@dnd-kit/modifiers';

// In useTableDnd hook
const modifiers = useMemo(() => [
  restrictToHorizontalAxis,
  restrictToParentElement, // Constrain to thead
], []);

// DndContext setup
<DndContext
  modifiers={modifiers}
  autoScroll={false} // CRITICAL: Disable auto-scroll
  // ...
>
```

This ensures:
1. Columns can only move horizontally within the current header row
2. Dragging to the edge doesn't cause the table to scroll or expand
3. User must manually scroll to access off-screen columns, then drag

## Implementation Phases

### Phase 1: Core Utilities
- [ ] Create `utils/column-sizing.ts` with pure functions
- [ ] Add types to `types.ts`
- [ ] Write unit tests for calculation functions

### Phase 2: Hooks
- [ ] Create `use-column-sizing.ts` (main orchestration hook)
- [ ] Create `use-column-resize.ts` (drag handling)
- [ ] Create `use-content-measurement.ts` (measure cells)

### Phase 3: Components
- [ ] Create `ResizeHandle.tsx`
- [ ] Update `DataTable.tsx` with resize support
- [ ] Add CSS styles

### Phase 4: Integration
- [ ] Update `resources-preferences-store.ts`
- [ ] Update `pools-preferences-store.ts`
- [ ] Wire up to ResourcesTable and PoolsTable

### Phase 5: Polish
- [ ] Add data-column-id attributes to cells
- [ ] Test with virtualization
- [ ] Performance profiling
- [ ] Accessibility review

## Testing Checklist

- [ ] Resize handle appears on hover
- [ ] Drag resize updates column width smoothly (60fps)
- [ ] Cannot resize below minWidth
- [ ] Double-click auto-fits to content
- [ ] Shift + double-click resets to proportional
- [ ] Proportional columns fill remaining space
- [ ] Columns don't exceed naturalWidth
- [ ] Horizontal scroll appears when needed
- [ ] Widths persist across page refreshes
- [ ] Works with virtualized rows
- [ ] Works with DnD column reordering
- [ ] No infinite re-render loops
- [ ] No flicker during drag
- [ ] **Table does NOT scroll during column resize**
- [ ] **Touch gestures don't trigger scroll during resize**
- [ ] **Resize works correctly after scroll position changes**
- [ ] **Pointer cancel (e.g., touch interrupted) cleans up correctly**
- [ ] **Fixed columns cannot be dragged (reorder)**
- [ ] **Fixed columns CAN be resized**
- [ ] **Fixed columns CAN be auto-fit (double-click)**
- [ ] **Columns cannot be dropped before fixed columns**
- [ ] **Fixed columns stay at the start of the order**

## Performance Budget

| Metric | Target |
|--------|--------|
| Drag frame rate | 60fps (16.6ms budget) |
| Drag input latency | < 50ms |
| Release-to-persist | < 100ms |
| Container resize recalc | < 10ms |
| Content measurement | < 5ms |
| Initial render | < 50ms |

## References

- [CALLBACK_STABILITY.md](./../../lib/docs/CALLBACK_STABILITY.md) - Callback patterns
- [PointerEvents API](https://developer.mozilla.org/en-US/docs/Web/API/Pointer_events)
- [ResizeObserver API](https://developer.mozilla.org/en-US/docs/Web/API/ResizeObserver)
- [CSS contain property](https://developer.mozilla.org/en-US/docs/Web/CSS/contain)
