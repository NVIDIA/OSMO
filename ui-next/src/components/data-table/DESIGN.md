# DataTable Design Document

## Overview

A canonical, high-performance table component built on [TanStack Table](https://tanstack.com/table) that serves as the foundation for all data tables in the application.

## Goals

1. **Native `<table>` markup** for accessibility (screen readers, keyboard nav)
2. **Virtualization** via TanStack Virtual for 1000+ rows
3. **DnD column reordering** via dnd-kit (existing)
4. **Sticky section headers** for grouped data (pools status sections)
5. **Infinite scroll pagination** for large datasets
6. **Single implementation** replacing pools and resources tables

## Non-Goals

- Row selection (handled by parent via click handlers)
- Search highlighting (handled by SmartSearch)
- Export to CSV

## Architecture

```
@/components/data-table/
├── DataTable.tsx           # Main component (TanStack Table + Virtual)
├── VirtualTableBody.tsx    # Virtualized <tbody> with <tr> elements
├── SectionHeader.tsx       # Sticky section row component
├── BottomSectionStack.tsx  # Jump-to-section UI (from pools)
├── SortButton.tsx          # ✅ Existing - keep
├── SortableCell.tsx        # ✅ Existing - keep
├── hooks/
│   ├── use-table-dnd.ts          # ✅ Existing - keep
│   ├── use-section-scroll.ts     # Extract from pools
│   └── use-virtualized-table.ts  # New - wraps TanStack Virtual for <table>
├── types.ts                # Type definitions
├── styles.css              # Table-specific styles
├── index.ts                # Public API
└── DESIGN.md               # This file
```

## Technical Approach

### Virtualization with Native `<table>`

TanStack Virtual works with any element. For `<table>`, we use:

```tsx
<table aria-rowcount={totalRows}>
  <thead>
    <tr>...</tr>
  </thead>
  <tbody style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
    {virtualizer.getVirtualItems().map((virtualRow) => (
      <tr
        key={row.id}
        aria-rowindex={virtualRow.index + 2}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: virtualRow.size,
          transform: `translateY(${virtualRow.start}px)`,
        }}
      >
        {cells}
      </tr>
    ))}
  </tbody>
</table>
```

Key points:
- `<tbody>` is positioned relatively with total height
- `<tr>` elements are absolutely positioned with transforms
- `aria-rowcount` and `aria-rowindex` for accessibility
- CSS containment for performance

### TanStack Table Integration

```tsx
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  flexRender,
  type ColumnDef,
} from '@tanstack/react-table';

const table = useReactTable({
  data,
  columns,
  getCoreRowModel: getCoreRowModel(),
  getSortedRowModel: getSortedRowModel(),
  onColumnOrderChange: setColumnOrder,
  state: {
    sorting,
    columnOrder,
    columnVisibility,
  },
});
```

### Sticky Section Headers

For pools-style grouped tables:

```tsx
<tr
  className="sticky z-10"
  style={{ top: headerHeight }}
>
  <td colSpan={columnCount}>
    <SectionHeader status="Online" count={5} />
  </td>
</tr>
```

Stacking: Main header (z-20) > Section header (z-10) > Rows (z-0)

### Column DnD

Keep existing dnd-kit integration:

```tsx
<th>
  <SortableCell id={column.id}>
    <SortButton label={column.label} onSort={handleSort} />
  </SortableCell>
</th>
```

## API Design

```typescript
interface DataTableProps<TData, TValue> {
  // === Data ===
  data: TData[];
  columns: ColumnDef<TData, TValue>[];
  getRowId: (row: TData) => string;

  // === Sections (optional) ===
  sections?: Section<TData>[];
  renderSectionHeader?: (section: Section<TData>) => ReactNode;
  stickyHeaders?: boolean;
  showBottomStack?: boolean;

  // === Column Management ===
  columnOrder?: string[];
  onColumnOrderChange?: (order: string[]) => void;
  columnVisibility?: Record<string, boolean>;
  onColumnVisibilityChange?: (visibility: Record<string, boolean>) => void;

  // === Sorting ===
  sorting?: SortingState;
  onSortingChange?: (sorting: SortingState) => void;

  // === Pagination ===
  hasNextPage?: boolean;
  onLoadMore?: () => void;
  isFetchingNextPage?: boolean;
  totalCount?: number;

  // === Layout ===
  rowHeight?: number;
  sectionHeight?: number;

  // === State ===
  isLoading?: boolean;

  // === Interaction ===
  onRowClick?: (row: TData) => void;

  // === Styling ===
  className?: string;
}
```

## Migration Plan

### Phase 1: Add Dependencies
```bash
pnpm add @tanstack/react-table
```
Note: @tanstack/react-virtual already installed (used by useVirtualizerCompat)

### Phase 2: Build Core Component
- [x] Create `DataTable.tsx` with TanStack Table
- [x] Create `VirtualTableBody.tsx` with native <table> virtualization
- [x] Create `use-virtualized-table.ts` hook
- [ ] Validate with simple test case

### Phase 3: Add Section Support
- [ ] Extract `use-section-scroll.ts` from pools
- [ ] Create `SectionHeader.tsx`
- [ ] Create `BottomSectionStack.tsx`
- [ ] Add sticky header CSS

### Phase 4: Migrate Resources
- [ ] Convert resource columns to TanStack format
- [ ] Replace ResourcesTable with DataTable
- [ ] Verify infinite scroll works
- [ ] Delete old resources table files

### Phase 5: Migrate Pools
- [ ] Convert pool columns to TanStack format
- [ ] Replace PoolsTable with DataTable + sections
- [ ] Verify sticky headers work
- [ ] Verify bottom stack works
- [ ] Delete old pools table files

### Phase 6: Cleanup
- [ ] Remove unused code
- [ ] Update documentation
- [ ] Performance testing

## Open Questions

1. **Column widths**: TanStack Table has its own sizing. Do we need to maintain minmax()?
   - Recommendation: Use CSS custom properties like current approach

2. **Section state**: Should collapsed sections be managed by DataTable or parent?
   - Recommendation: Parent manages via props (controlled)

3. **Custom cells**: Keep renderCell pattern or use TanStack's cell renderer?
   - Recommendation: Use TanStack's `cell` property in column defs

## References

- [TanStack Table Docs](https://tanstack.com/table/latest/docs)
- [TanStack Virtual Docs](https://tanstack.com/virtual/latest/docs)
- [Virtualization with <table>](https://tanstack.com/virtual/latest/docs/framework/react/examples/table)
