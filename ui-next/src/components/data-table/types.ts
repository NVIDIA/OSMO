/**
 * Copyright (c) 2026, NVIDIA CORPORATION. All rights reserved.
 *
 * NVIDIA CORPORATION and its licensors retain all intellectual property
 * and proprietary rights in and to this software, related documentation
 * and any modifications thereto. Any use, reproduction, disclosure or
 * distribution of this software and related documentation without an express
 * license agreement from NVIDIA CORPORATION is strictly prohibited.
 */

/**
 * Virtualized Table Types
 *
 * Unified type system for the generic virtualized table component.
 * Supports both flat lists (resources) and grouped sections (pools).
 */

// =============================================================================
// Column Configuration
// =============================================================================

/**
 * Column definition for the table.
 * Uses minWidth + flex for CSS Grid sizing.
 */
export interface ColumnConfig<TColumnId extends string = string> {
  /** Unique column identifier */
  id: TColumnId;
  /** Header label (shown in table header) */
  label: string;
  /** Menu label for column picker (defaults to label) */
  menuLabel?: string;
  /** Minimum width in pixels */
  minWidth: number;
  /** Flex value for proportional sizing (fr units) */
  flex: number;
  /** Column alignment */
  align?: "left" | "right";
  /** Is column sortable? Default: true */
  sortable?: boolean;
  /** Is column mandatory (can't be hidden or reordered)? */
  mandatory?: boolean;
}

/**
 * Generate CSS grid-template-columns from column config.
 */
export function columnsToGridTemplate<TColumnId extends string>(
  columns: ColumnConfig<TColumnId>[],
  visibleIds: TColumnId[],
): string {
  return visibleIds
    .map((id) => columns.find((c) => c.id === id))
    .filter((c): c is ColumnConfig<TColumnId> => c !== undefined)
    .map((c) => `minmax(${c.minWidth}px, ${c.flex}fr)`)
    .join(" ");
}

/**
 * Get visible columns in order.
 */
export function getVisibleColumns<TColumnId extends string>(
  columns: ColumnConfig<TColumnId>[],
  visibleIds: TColumnId[],
): ColumnConfig<TColumnId>[] {
  return visibleIds
    .map((id) => columns.find((c) => c.id === id))
    .filter((c): c is ColumnConfig<TColumnId> => c !== undefined);
}

/**
 * Separate mandatory and optional columns.
 */
export function partitionColumns<TColumnId extends string>(
  columns: ColumnConfig<TColumnId>[],
  visibleIds: TColumnId[],
): {
  mandatory: ColumnConfig<TColumnId>[];
  optional: ColumnConfig<TColumnId>[];
  optionalIds: TColumnId[];
} {
  const visible = getVisibleColumns(columns, visibleIds);
  const mandatory = visible.filter((c) => c.mandatory);
  const optional = visible.filter((c) => !c.mandatory);

  return {
    mandatory,
    optional,
    optionalIds: optional.map((c) => c.id),
  };
}

// =============================================================================
// Sort State
// =============================================================================

export type SortDirection = "asc" | "desc";

export interface SortState<TColumnId extends string = string> {
  column: TColumnId | null;
  direction: SortDirection;
}

/**
 * Cycle sort state: asc -> desc -> none
 */
export function cycleSortState<TColumnId extends string>(
  current: SortState<TColumnId>,
  columnId: TColumnId,
): SortState<TColumnId> {
  if (current.column !== columnId) {
    return { column: columnId, direction: "asc" };
  }
  if (current.direction === "asc") {
    return { column: columnId, direction: "desc" };
  }
  return { column: null, direction: "asc" };
}

// =============================================================================
// Section/Group Configuration
// =============================================================================

/**
 * A section groups items together with a header.
 * Used for status-based grouping in pools table.
 */
export interface Section<T, TMetadata = unknown> {
  /** Unique section ID */
  id: string;
  /** Section header label */
  label: string;
  /** Items in this section */
  items: T[];
  /** Optional metadata for styling (e.g., status color) */
  metadata?: TMetadata;
}

// =============================================================================
// Virtual Item Types
// =============================================================================

/**
 * Virtual items can be either section headers or data rows.
 * This allows the virtualizer to handle mixed content.
 */
export type VirtualItem<T, TMetadata = unknown> =
  | { type: "section"; section: Section<T, TMetadata>; index: number }
  | { type: "row"; item: T; sectionId?: string; index: number };

/**
 * Convert sections to flat virtual items array.
 */
export function sectionsToVirtualItems<T, TMetadata = unknown>(
  sections: Section<T, TMetadata>[],
): VirtualItem<T, TMetadata>[] {
  const items: VirtualItem<T, TMetadata>[] = [];
  let index = 0;

  for (const section of sections) {
    items.push({ type: "section", section, index: index++ });
    for (const item of section.items) {
      items.push({ type: "row", item, sectionId: section.id, index: index++ });
    }
  }

  return items;
}

/**
 * Convert flat items array to virtual items (no sections).
 */
export function itemsToVirtualItems<T>(items: T[]): VirtualItem<T, never>[] {
  return items.map((item, index) => ({ type: "row", item, index }));
}

// =============================================================================
// Table Props
// =============================================================================

export interface DataTableProps<
  T,
  TColumnId extends string = string,
  TMetadata = unknown,
> {
  // === Data ===
  /** Items to display (used when not using sections) */
  items?: T[];
  /** Sections to display (alternative to items, for grouped tables) */
  sections?: Section<T, TMetadata>[];
  /** Unique key extractor for each item */
  getRowKey: (item: T) => string;

  // === Columns ===
  /** Column definitions */
  columns: ColumnConfig<TColumnId>[];
  /** Visible column IDs (order matters for display) */
  visibleColumnIds: TColumnId[];
  /** Callback when column order changes via DnD */
  onColumnOrderChange?: (columnIds: TColumnId[]) => void;

  // === Rendering ===
  /** Render a cell for a given item and column */
  renderCell: (item: T, columnId: TColumnId) => React.ReactNode;
  /** Custom section header renderer (required if using sections) */
  renderSectionHeader?: (
    section: Section<T, TMetadata>,
    columnCount: number,
  ) => React.ReactNode;
  /** Empty state content */
  emptyState?: React.ReactNode;
  /** Loading skeleton row count */
  loadingRowCount?: number;

  // === Sorting ===
  /** Current sort state */
  sort?: SortState<TColumnId>;
  /** Callback when sort changes */
  onSortChange?: (sort: SortState<TColumnId>) => void;

  // === Layout ===
  /** Row height in pixels */
  rowHeight: number;
  /** Section header height in pixels (required if using sections) */
  sectionHeight?: number;
  /** Compact mode flag (for styling hooks) */
  compact?: boolean;

  // === Infinite Scroll ===
  /** Whether more data is available */
  hasNextPage?: boolean;
  /** Load more callback (called when scrolling near end) */
  onLoadMore?: () => void;
  /** Is currently loading more? */
  isFetchingNextPage?: boolean;
  /** Total count for "X of Y loaded" display */
  totalCount?: number;

  // === State ===
  /** Loading state (initial load, shows skeleton) */
  isLoading?: boolean;

  // === Interaction ===
  /** Row click handler */
  onRowClick?: (item: T, event: React.MouseEvent | React.KeyboardEvent) => void;
  /** Currently selected item key (for highlighting) */
  selectedKey?: string | null;

  // === Styling ===
  /** Additional class for table container */
  className?: string;
  /** CSS class for scroll container (e.g., for custom scrollbar) */
  scrollClassName?: string;
  /** CSS class applied to each row */
  rowClassName?: string | ((item: T) => string);
}

// =============================================================================
// Table Header Props
// =============================================================================

export interface TableHeaderProps<TColumnId extends string = string> {
  /** All column definitions */
  columns: ColumnConfig<TColumnId>[];
  /** Visible column IDs in order */
  visibleColumnIds: TColumnId[];
  /** Optional column IDs (draggable) in order */
  optionalColumnIds: TColumnId[];
  /** Current sort state */
  sort: SortState<TColumnId>;
  /** Sort change handler */
  onSort: (columnId: TColumnId) => void;
  /** Compact mode */
  compact?: boolean;
  /** CSS grid template string */
  gridTemplate: string;
  /** Is header scrolled (for shadow effect) */
  isScrolled?: boolean;
}

// =============================================================================
// Sort Button Props
// =============================================================================

export interface SortButtonProps {
  /** Column identifier */
  id: string;
  /** Button label */
  label: string;
  /** Column alignment */
  align?: "left" | "right";
  /** Is sorting enabled for this column? */
  sortable?: boolean;
  /** Is this column currently sorted? */
  isActive: boolean;
  /** Current sort direction (only relevant if active) */
  direction?: SortDirection;
  /** Click handler */
  onSort: () => void;
}

// =============================================================================
// Sortable Cell Props
// =============================================================================

export interface SortableCellProps {
  /** Column ID (used as DnD item ID) */
  id: string;
  /** Cell content */
  children: React.ReactNode;
  /** Additional class names */
  className?: string;
  /** Render as th or div */
  as?: "th" | "div";
}
