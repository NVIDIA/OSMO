# Optimized Prompts for Local LLMs

> **Usage**: Copy these prompts and fill in the [PLACEHOLDERS]. Local models work best with explicit context.

---

## Creating a New Component

```
I'm working on a Next.js/React/TypeScript project. Here are the conventions:

ARCHITECTURE:
- Pages compose headless hooks + themed components
- Headless hooks contain business logic (no UI)
- Themed components receive data as props (no data fetching)

STYLING:
- Use Tailwind CSS classes only
- Include dark mode: `dark:...` variants
- NVIDIA green brand color: `var(--nvidia-green)`

Here's an example component from my codebase:
[PASTE EXAMPLE FROM examples/components/]

Now create a new component that [DESCRIBE WHAT YOU WANT].

Requirements:
- TypeScript with explicit prop types
- Include JSDoc comments for props
- Memoize sub-components with React.memo()
- Use useCallback for event handlers
- Support dark mode
```

---

## Creating a Headless Hook

```
I'm working on a Next.js project with a headless hook pattern.

PATTERN:
- Hooks in src/headless/ contain ALL business logic
- They return data, state, setters, and callbacks
- NO UI code or JSX in hooks
- Data fetching via adapter hooks from @/lib/api/adapter

Here's an example headless hook:
[PASTE EXAMPLE FROM examples/hooks/]

Create a headless hook called use[NAME] that:
- [DESCRIBE WHAT DATA IT MANAGES]
- [DESCRIBE WHAT FILTERING/SORTING IT DOES]
- [DESCRIBE WHAT CALLBACKS IT PROVIDES]

Return type should include:
- data: [TYPE]
- isLoading: boolean
- error: HTTPValidationError | null
- [OTHER STATE AND CALLBACKS]
```

---

## Creating an E2E Test

```
I'm writing Playwright E2E tests for a Next.js app.

TEST PATTERN:
- Use custom fixtures: test, expect, withData, createPoolResponse, createResourcesResponse
- Use generated enums: PoolStatus, BackendResourceType (not string literals)
- AAA pattern: Arrange (withData), Act (goto/interact), Assert (expect)

Here's an example test:
[PASTE EXAMPLE FROM examples/tests/]

Create a test that verifies:
- [DESCRIBE THE SCENARIO]
- [DESCRIBE THE EXPECTED BEHAVIOR]

Mock data needed:
- Pools: [DESCRIBE POOL CONFIGURATION]
- Resources: [DESCRIBE RESOURCE CONFIGURATION]
```

---

## Adding a Filter to an Existing Component

```
I have a resource table component with filtering. Here's how filters work:

FILTER BAR PATTERN (compound component):
<FilterBar activeFilters={filters} onRemoveFilter={remove} onClearAll={clear}>
  <FilterBar.Search value={search} onChange={setSearch} />
  <FilterBar.MultiSelect label="X" options={opts} selected={sel} onToggle={toggle} />
  <FilterBar.SingleSelect label="Y" options={opts} value={val} onChange={setVal} />
  <FilterBar.Toggle label="View" options={[{value,label}]} value={v} onChange={set} />
</FilterBar>

FILTER STATE (in headless hook):
const [selectedX, setSelectedX] = useState<Set<string>>(new Set());

const toggleX = useCallback((x: string) => {
  setSelectedX((prev) => {
    const next = new Set(prev);
    if (next.has(x)) next.delete(x);
    else next.add(x);
    return next;
  });
}, []);

const filtered = useMemo(() => {
  let result = data;
  if (selectedX.size > 0) {
    result = result.filter((item) => selectedX.has(item.x));
  }
  return result;
}, [data, selectedX]);

Add a new filter for [FIELD_NAME] to:
1. The headless hook (state + toggle + filter logic)
2. The page component (FilterBar.X component)
```

---

## Fixing a Bug

```
I have a bug in my React component.

CONTEXT:
[PASTE THE COMPONENT CODE]

BUG DESCRIPTION:
[DESCRIBE WHAT'S HAPPENING]

EXPECTED BEHAVIOR:
[DESCRIBE WHAT SHOULD HAPPEN]

PROJECT CONVENTIONS:
- Memoize components receiving object/array props with React.memo()
- Use useCallback for event handlers passed to children
- Use useMemo for computed values
- Wrap expensive updates in startTransition()

Please identify the bug and provide a fix.
```

---

## Refactoring for Performance

```
I need to optimize this component for performance.

PERFORMANCE PATTERNS IN THIS PROJECT:
- GPU-accelerated only: transform, opacity (not top, left, height)
- CSS containment: contain: strict on containers
- Virtualization: @tanstack/react-virtual for lists > 50 items
- Memoization: React.memo, useCallback, useMemo
- Non-blocking: startTransition, useDeferredValue

COMPONENT:
[PASTE COMPONENT CODE]

PERFORMANCE ISSUE:
[DESCRIBE THE PROBLEM - laggy scroll, slow filter, etc.]

Please optimize this component following the project patterns.
```

---

## Converting a Component to Use Virtualization

```
I need to add virtualization to a list component.

VIRTUALIZATION PATTERN:
```tsx
import { useVirtualizer } from "@tanstack/react-virtual";

function VirtualList({ items }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 48,
    overscan: 5,
  });

  return (
    <div ref={scrollRef} className="h-full overflow-auto">
      <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
        {virtualizer.getVirtualItems().map((vRow) => (
          <div
            key={vRow.key}
            style={{
              height: vRow.size,
              transform: `translate3d(0, ${vRow.start}px, 0)`,
            }}
            className="absolute left-0 right-0"
          >
            {items[vRow.index].name}
          </div>
        ))}
      </div>
    </div>
  );
}
```

CURRENT COMPONENT:
[PASTE YOUR COMPONENT]

Convert this to use virtualization. The row height is [X] pixels.
```

---

## Quick Reference Snippets

### Memoized Sub-component
```tsx
const Row = memo(function Row({ data }: { data: Item }) {
  return <div>{data.name}</div>;
});
```

### Stable Callback
```tsx
const handleClick = useCallback((id: string) => {
  setSelected(id);
}, []);
```

### Filtered Data
```tsx
const filtered = useMemo(() => {
  if (!search.trim()) return items;
  const q = search.toLowerCase();
  return items.filter((i) => i.name.toLowerCase().includes(q));
}, [items, search]);
```

### Non-blocking Sort
```tsx
const handleSort = useCallback((col: SortColumn) => {
  startTransition(() => {
    setSort((prev) => ({ ...prev, column: col }));
  });
}, []);
```

### Toggle Set Item
```tsx
const toggle = useCallback((item: string) => {
  setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(item)) next.delete(item);
    else next.add(item);
    return next;
  });
}, []);
```
