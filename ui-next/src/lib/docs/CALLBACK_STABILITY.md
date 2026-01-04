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

### ✅ Use Refs for Frequently-Changing Data

```tsx
// GOOD: Ref provides stable access, callback stays stable
const itemsRef = useRef(items);
itemsRef.current = items;

const estimateSize = useCallback(
  (index: number) => itemsRef.current[index]?.height ?? 48,
  [],  // ✅ No dependencies - always stable
);
```

### ✅ Stable Callback Pattern

```tsx
// GOOD: Create stable callbacks that read from refs
const onChangeRef = useRef(onChange);
onChangeRef.current = onChange;

const stableOnChange = useCallback(
  (value) => onChangeRef.current?.(value),
  [],  // ✅ Stable reference
);
```

### ✅ Memoize Derived Data Properly

```tsx
// GOOD: Memoize the derived data if needed as dependency
const filteredItems = useMemo(
  () => items.filter(x => x.active),
  [items],
);

// Or better - use ref pattern
const itemsRef = useRef(items);
itemsRef.current = items;

const getFilteredItem = useCallback(
  (index) => {
    const filtered = itemsRef.current.filter(x => x.active);
    return filtered[index];
  },
  [],
);
```

### ✅ Extract to Custom Hook

```tsx
// GOOD: Encapsulate the ref pattern in a reusable hook
function useStableCallback<T extends (...args: any[]) => any>(callback: T): T {
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  return useCallback(
    ((...args) => callbackRef.current?.(...args)) as T,
    [],
  );
}

// Usage
const stableOnChange = useStableCallback(onChange);
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
| `useRef` + stable callback | Data changes frequently, callback passed to library |
| `useMemo` for derived data | Derived data used in multiple places |
| `useCallback` with primitives | Simple callbacks with primitive dependencies |
| Custom `useStableCallback` hook | Reusable pattern across codebase |

## Related Files

- `src/components/data-table/hooks/use-virtualized-table.ts` - Example of ref pattern
- `src/components/data-table/DataTable.tsx` - Example of stable callback refs
