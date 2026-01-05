<!--
Copyright (c) 2026, NVIDIA CORPORATION. All rights reserved.

NVIDIA CORPORATION and its licensors retain all intellectual property
and proprietary rights in and to this software, related documentation
and any modifications thereto. Any use, reproduction, disclosure or
distribution of this software and related documentation without an express
license agreement from NVIDIA CORPORATION is strictly prohibited.
-->

# Callback Stability Best Practices

This document outlines best practices for preventing infinite re-render loops caused by unstable callback references in React components.

## The Problem

React's reconciliation algorithm compares prop references to determine if a component needs to re-render. When callbacks change reference on every render, it can cause:

1. **Unnecessary re-renders** - Child components re-render even when nothing meaningful changed
2. **Broken memoization** - `React.memo()` becomes ineffective
3. **Infinite loops** - With third-party libraries that trigger state updates when options change

## Common Anti-Patterns

### ❌ Array/Object Dependencies in useCallback

```tsx
// BAD: items changes on every render → callback changes → potential loop
const estimateSize = useCallback(
  (index: number) => items[index]?.height ?? 48,
  [items],  // ❌ Array reference changes frequently
);

// Passed to library that triggers updates when options change
const virtualizer = useVirtualizer({
  estimateSize,  // New function each render!
});
```

### ❌ Inline Functions to Third-Party Hooks

```tsx
// BAD: New function reference on every render
const virtualizer = useVirtualizer({
  getItemKey: (index) => items[index].id,  // ❌ Inline function
});
```

### ❌ Derived State in Dependencies

```tsx
// BAD: filteredItems is new array each render
const filteredItems = items.filter(x => x.active);
const handleClick = useCallback(
  (index) => filteredItems[index],
  [filteredItems],  // ❌ Always a new reference
);
```

## Solutions

### ✅ Use `useStableValue` for Frequently-Changing Data

```tsx
import { useStableValue } from "@/hooks";

// GOOD: Stable ref provides access to latest data
const itemsRef = useStableValue(items);

const estimateSize = useCallback(
  (index: number) => itemsRef.current[index]?.height ?? 48,
  [itemsRef],  // ✅ Stable - won't cause re-renders
);
```

### ✅ Use `useStableCallback` for Callback Props

```tsx
import { useStableCallback } from "@/hooks";

// GOOD: Stable callback reference that always calls latest version
const stableOnChange = useStableCallback(onChange);

// Safe to pass to third-party libraries
const virtualizer = useVirtualizer({
  onChange: stableOnChange,  // ✅ Won't trigger recreation
});
```

### ✅ Memoize Derived Data Properly

```tsx
import { useStableValue } from "@/hooks";

// GOOD: Memoize the derived data if needed as dependency
const filteredItems = useMemo(
  () => items.filter(x => x.active),
  [items],
);

// Or better - use stable ref pattern
const itemsRef = useStableValue(items);

const getFilteredItem = useCallback(
  (index) => {
    const filtered = itemsRef.current.filter(x => x.active);
    return filtered[index];
  },
  [itemsRef],
);
```

### ✅ Use the Built-in Stable Hooks

```tsx
import { useStableCallback, useStableValue } from "@/hooks";

// GOOD: Stable callback reference
const stableOnChange = useStableCallback(onChange);

// GOOD: Stable ref to frequently-changing data
const itemsRef = useStableValue(items);

// Use in callbacks without adding to dependencies
const getItem = useCallback(
  (index) => itemsRef.current[index],
  [itemsRef], // Stable - won't cause re-renders
);
```

## When to Apply These Patterns

Apply the ref pattern when:

1. **Passing callbacks to third-party libraries** (TanStack Virtual, TanStack Table, dnd-kit, etc.)
2. **Callbacks depend on frequently-changing data** (arrays, objects, filtered/sorted data)
3. **Performance profiler shows excessive re-renders**

## Third-Party Libraries That Need Stable Callbacks

These libraries are known to trigger updates when options change:

- `@tanstack/react-virtual` - `useVirtualizer` options
- `@tanstack/react-table` - `useReactTable` options
- `@dnd-kit/core` - Sensor and modifier callbacks
- React Query - Query function and options
- Zustand - Selector functions (use shallow comparison)

## Testing for Stability Issues

1. **React DevTools Profiler** - Check for unnecessary renders
2. **Console logging** - Add render counts to components
3. **Strict Mode** - Double-invokes effects to catch issues
4. **ESLint rules** - Enable `react-hooks/exhaustive-deps`

## Summary

| Pattern | When to Use |
|---------|-------------|
| `useStableCallback(fn)` | Callback props passed to third-party libraries |
| `useStableValue(data)` | Access frequently-changing data in stable callbacks |
| `useMemo` for derived data | Derived data used in multiple places |
| `useCallback` with primitives | Simple callbacks with primitive dependencies |

## Related Files

- `src/hooks/use-stable-callback.ts` - The `useStableCallback` and `useStableValue` hooks
- `src/components/data-table/hooks/use-virtualized-table.ts` - Example usage with TanStack Virtual
- `src/components/data-table/hooks/use-unified-column-sizing.ts` - Example usage for resize handlers
- `src/components/data-table/DataTable.tsx` - Example usage for stable table callbacks
