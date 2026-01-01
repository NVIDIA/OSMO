/**
 * Copyright (c) 2025, NVIDIA CORPORATION. All rights reserved.
 *
 * NVIDIA CORPORATION and its licensors retain all intellectual property
 * and proprietary rights in and to this software, related documentation
 * and any modifications thereto. Any use, reproduction, disclosure or
 * distribution of this software and related documentation without an express
 * license agreement from NVIDIA CORPORATION is strictly prohibited.
 */

/**
 * PoolsTable Component
 *
 * Unified table with stacked sticky section headers:
 * - Table header: always sticky at top (z-20)
 * - Section rows: sticky and stack below header as you scroll (z-10+)
 * - Pool rows: rendered within each section
 *
 * Behavior:
 * - As you scroll through a section, its header sticks below the table header
 * - When you reach the next section, its header stacks below the previous one
 * - Click any section header to jump to that section's content
 * - Empty sections are hidden (no pools = no section row)
 */

"use client";

import { memo, useMemo, useCallback, useRef, useState, useEffect } from "react";
import { ChevronDown, ChevronUp, ChevronsUpDown } from "lucide-react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  horizontalListSortingStrategy,
} from "@dnd-kit/sortable";
import { cn } from "@/lib/utils";
import { getGridTemplate, getMinTableWidth, getOrderedColumns, type ColumnDef, type SortState } from "@/lib/table";
import type { Pool, PoolsResponse } from "@/lib/api/adapter";
import { filterByChips } from "@/components/ui/smart-search";
import { usePoolsTableStore, usePoolsExtendedStore } from "./stores/pools-table-store";
import { GpuProgressCell } from "./gpu-progress-cell";
import { PlatformPills } from "./platform-pills";
import {
  COLUMN_MAP,
  MANDATORY_COLUMN_IDS,
  type PoolColumnId,
} from "./pool-columns";
import { POOL_SEARCH_FIELDS } from "./pool-search-fields";
import { STATUS_ORDER, getStatusDisplay, LAYOUT } from "./constants";
import "./pools.css";

// =============================================================================
// Layout Utilities - Read from CSS Custom Properties
// =============================================================================

/**
 * Parse a CSS value to pixels.
 * Handles rem, em, px, and bare numbers.
 */
function cssToPixels(value: string, rootFontSize = 16): number {
  const trimmed = value.trim();
  if (trimmed.endsWith("rem")) {
    return parseFloat(trimmed) * rootFontSize;
  }
  if (trimmed.endsWith("em")) {
    return parseFloat(trimmed) * rootFontSize;
  }
  if (trimmed.endsWith("px")) {
    return parseFloat(trimmed);
  }
  return parseFloat(trimmed) || 0;
}

/**
 * Get CSS custom property value from :root.
 */
function getCssVar(name: string): string {
  if (typeof document === "undefined") return "";
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/**
 * Hook to read layout dimensions from CSS custom properties.
 * This ensures dimensions stay in sync with CSS and scale with user preferences.
 */
function useLayoutDimensions() {
  const [dimensions, setDimensions] = useState({
    headerHeight: 36,
    sectionHeight: 36,
    rowHeight: 48,
    rowHeightCompact: 32,
    minTableHeight: 400,
  });

  useEffect(() => {
    const rootFontSize = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;

    setDimensions({
      headerHeight: cssToPixels(getCssVar("--pools-header-height") || "2.25rem", rootFontSize),
      sectionHeight: cssToPixels(getCssVar("--pools-section-height") || "2.25rem", rootFontSize),
      rowHeight: cssToPixels(getCssVar("--pools-row-height") || "3rem", rootFontSize),
      rowHeightCompact: cssToPixels(getCssVar("--pools-row-height-compact") || "2rem", rootFontSize),
      minTableHeight: cssToPixels(getCssVar("--pools-table-min-height") || "25rem", rootFontSize),
    });
  }, []);

  return dimensions;
}

// Default gap from CSS (could also be a CSS var if needed)
const DEFAULT_GAP = 24;

// Horizontal-only modifier for DND
const restrictToHorizontalAxis = ({ transform }: { transform: { x: number; y: number; scaleX: number; scaleY: number } }) => ({
  ...transform,
  y: 0,
  scaleX: 1,
  scaleY: 1,
});

// =============================================================================
// Types
// =============================================================================

interface PoolsTableProps {
  poolsData: PoolsResponse | null;
  isLoading?: boolean;
  error?: Error | null;
  onRetry?: () => void;
}

interface StatusSection {
  status: string;
  label: string;
  icon: string;
  pools: Pool[];
}

// =============================================================================
// Section Header Component (Sticky + Stacking)
// =============================================================================

interface SectionRowProps {
  status: string;
  label: string;
  icon: string;
  count: number;
  sectionIndex: number; // Used for CSS data-attribute based positioning
  onJumpTo: () => void;
}

/**
 * SectionRow uses CSS-based sticky positioning via data-section-index attribute.
 * All layout calculations (top, z-index, height) are handled in pools.css.
 * This eliminates JS recalculation and leverages GPU-accelerated CSS.
 */
const SectionRow = memo(function SectionRow({
  status,
  label,
  icon,
  count,
  sectionIndex,
  onJumpTo,
}: SectionRowProps) {
  return (
    <button
      type="button"
      onClick={onJumpTo}
      data-section-index={sectionIndex}
      className={cn(
        "pools-section-row", // CSS handles: sticky, top, height, z-index, background
        "flex w-full items-center gap-2 px-3",
        "border-b border-zinc-200 dark:border-zinc-700",
        "text-left text-sm font-medium",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-inset",
        "transition-shadow duration-150",
      )}
      aria-label={`Jump to ${label} section`}
    >
      <span>{icon}</span>
      <span className="text-zinc-900 dark:text-zinc-100">{label}</span>
      <span className="text-zinc-500 dark:text-zinc-400">({count})</span>
    </button>
  );
});

// =============================================================================
// Bottom Section Stack (mirrors top sticky behavior for sections below viewport)
// =============================================================================

interface BottomSectionStackProps {
  sections: StatusSection[];
  hiddenSectionIndices: number[];
  onJumpTo: (index: number) => void;
}

/**
 * BottomSectionStack uses CSS-based positioning via data-stack-index attribute.
 * All layout calculations (bottom, z-index, height) are handled in pools.css.
 */
const BottomSectionStack = memo(function BottomSectionStack({
  sections,
  hiddenSectionIndices,
  onJumpTo,
}: BottomSectionStackProps) {
  if (hiddenSectionIndices.length === 0) return null;

  // Reverse order so nearest section is at the bottom of the stack (closest to content)
  const reversedIndices = [...hiddenSectionIndices].reverse();

  return (
    <div className="absolute inset-x-0 bottom-0 z-20 pointer-events-none">
      {reversedIndices.map((sectionIndex, stackIndex) => {
        const section = sections[sectionIndex];

        return (
          <button
            key={section.status}
            type="button"
            onClick={() => onJumpTo(sectionIndex)}
            data-stack-index={stackIndex}
            className={cn(
              "pools-bottom-section absolute inset-x-0 pointer-events-auto",
              "flex w-full items-center gap-2 px-3",
              "border-t border-zinc-200 dark:border-zinc-700",
              "text-left text-sm font-medium",
              "focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-inset",
            )}
            style={{ height: "var(--pools-section-height)" }}
            aria-label={`Jump to ${section.label} section`}
          >
            <span>{section.icon}</span>
            <span className="text-zinc-900 dark:text-zinc-100">{section.label}</span>
            <span className="text-zinc-500 dark:text-zinc-400">({section.pools.length})</span>
          </button>
        );
      })}
    </div>
  );
});

// =============================================================================
// Sorting Logic
// =============================================================================

function sortPools(pools: Pool[], sort: SortState<PoolColumnId>): Pool[] {
  if (!sort.column) return pools;

  return [...pools].sort((a, b) => {
    let cmp = 0;
    switch (sort.column) {
      case "name":
        cmp = a.name.localeCompare(b.name);
        break;
      case "description":
        cmp = (a.description ?? "").localeCompare(b.description ?? "");
        break;
      case "quota":
        cmp = a.quota.used - b.quota.used;
        break;
      case "capacity":
        cmp = a.quota.totalUsage - b.quota.totalUsage;
        break;
      case "platforms":
        cmp = a.platforms.length - b.platforms.length;
        break;
      case "backend":
        cmp = a.backend.localeCompare(b.backend);
        break;
    }
    return sort.direction === "asc" ? cmp : -cmp;
  });
}

// =============================================================================
// Cell Renderer
// =============================================================================

function PoolCell({
  pool,
  columnId,
  displayMode,
  compact,
  isShared,
}: {
  pool: Pool;
  columnId: PoolColumnId;
  displayMode: "used" | "free";
  compact: boolean;
  isShared: boolean;
}) {
  switch (columnId) {
    case "name":
      return (
        <span className="truncate font-medium text-zinc-900 dark:text-zinc-100">
          {pool.name}
        </span>
      );
    case "description":
      return (
        <span className="truncate text-zinc-500 dark:text-zinc-400">
          {pool.description || "—"}
        </span>
      );
    case "quota":
      return (
        <GpuProgressCell
          quota={pool.quota}
          type="quota"
          displayMode={displayMode}
          compact={compact}
        />
      );
    case "capacity":
      return (
        <GpuProgressCell
          quota={pool.quota}
          type="capacity"
          displayMode={displayMode}
          compact={compact}
          isShared={isShared}
        />
      );
    case "platforms":
      return <PlatformPills platforms={pool.platforms} maxVisible={compact ? 1 : 2} />;
    case "backend":
      return (
        <span className="font-mono text-xs text-zinc-500 dark:text-zinc-400">
          {pool.backend}
        </span>
      );
    default:
      return <span>—</span>;
  }
}

// =============================================================================
// Sortable Header Cell (for DND)
// =============================================================================

function SortableHeaderCell({
  col,
  sort,
  onSort,
}: {
  col: ColumnDef<PoolColumnId>;
  sort: SortState<PoolColumnId>;
  onSort: (column: PoolColumnId) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging, node } = useSortable({ id: col.id });
  const width = node.current?.offsetWidth;

  const style: React.CSSProperties = {
    transform: transform ? `translate3d(${transform.x}px, 0, 0)` : undefined,
    transition,
    zIndex: isDragging ? 10 : undefined,
    opacity: isDragging ? 0.8 : 1,
    width: isDragging && width ? width : undefined,
  };

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (col.sortable) onSort(col.id);
    },
    [col.id, col.sortable, onSort],
  );

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      role="columnheader"
      style={style}
      className={cn(
        "flex cursor-grab items-center active:cursor-grabbing",
        isDragging && "rounded bg-zinc-200 px-2 shadow-md ring-1 ring-zinc-300 dark:bg-zinc-700 dark:ring-zinc-600",
        col.align === "right" && "justify-end",
      )}
    >
      <button
        onClick={handleClick}
        disabled={!col.sortable}
        aria-sort={sort.column === col.id ? (sort.direction === "asc" ? "ascending" : "descending") : undefined}
        className={cn(
          "flex items-center gap-1 truncate transition-colors",
          col.sortable && "hover:text-zinc-900 dark:hover:text-zinc-100",
        )}
      >
        <span className="truncate">{col.label}</span>
        {col.sortable &&
          (sort.column === col.id ? (
            sort.direction === "asc" ? (
              <ChevronUp className="size-3 shrink-0" aria-hidden="true" />
            ) : (
              <ChevronDown className="size-3 shrink-0" aria-hidden="true" />
            )
          ) : (
            <ChevronsUpDown className="size-3 shrink-0 opacity-30" aria-hidden="true" />
          ))}
      </button>
    </div>
  );
}

const MemoizedSortableHeaderCell = memo(SortableHeaderCell);

// =============================================================================
// Pool Row Component
// =============================================================================

interface PoolRowProps {
  pool: Pool;
  columns: ColumnDef<PoolColumnId>[];
  gridTemplate: string;
  minWidth: number;
  gap: number;
  isSelected: boolean;
  onSelect: () => void;
  displayMode: "used" | "free";
  compact: boolean;
  isShared: boolean;
}

/**
 * PoolRow uses CSS-based height via data-compact attribute.
 * Hover/selection states handled via data-selected and data-status in CSS.
 * This eliminates JS style recalculations and leverages browser CSS optimization.
 */
const PoolRow = memo(function PoolRow({
  pool,
  columns,
  gridTemplate,
  minWidth,
  gap,
  isSelected,
  onSelect,
  displayMode,
  compact,
  isShared,
}: PoolRowProps) {
  const { category } = getStatusDisplay(pool.status);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onSelect();
      }
    },
    [onSelect],
  );

  return (
    <div
      role="row"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={handleKeyDown}
      aria-selected={isSelected}
      data-status={category}
      data-selected={isSelected}
      data-compact={compact}
      className={cn(
        "pools-row grid cursor-pointer items-center border-b border-zinc-200 px-3 text-sm dark:border-zinc-800",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500",
        // CSS handles: height (via data-compact), hover bg (via data-selected), status border (via data-status)
      )}
      style={{
        gridTemplateColumns: gridTemplate,
        minWidth,
        gap,
      }}
    >
      {columns.map((col) => (
        <div
          key={col.id}
          role="cell"
          className={cn("flex items-center overflow-hidden", col.align === "right" && "justify-end")}
        >
          <PoolCell
            pool={pool}
            columnId={col.id}
            displayMode={displayMode}
            compact={compact}
            isShared={isShared}
          />
        </div>
      ))}
    </div>
  );
});

// =============================================================================
// Table Header Component
// =============================================================================

interface TableHeaderProps {
  columns: ColumnDef<PoolColumnId>[];
  gridTemplate: string;
  minWidth: number;
  gap: number;
  headerHeight: number;
  sort: SortState<PoolColumnId>;
  onSort: (column: PoolColumnId) => void;
  optionalColumnIds: PoolColumnId[];
  onReorder: (newOrder: PoolColumnId[]) => void;
}

const TableHeader = memo(function TableHeader({
  columns,
  gridTemplate,
  minWidth,
  gap,
  headerHeight,
  sort,
  onSort,
  optionalColumnIds,
  onReorder,
}: TableHeaderProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (over && active.id !== over.id) {
        const oldIndex = optionalColumnIds.indexOf(active.id as PoolColumnId);
        const newIndex = optionalColumnIds.indexOf(over.id as PoolColumnId);
        if (oldIndex !== -1 && newIndex !== -1) {
          onReorder(arrayMove(optionalColumnIds, oldIndex, newIndex));
        }
      }
    },
    [optionalColumnIds, onReorder],
  );

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={handleDragEnd}
      modifiers={[restrictToHorizontalAxis]}
      autoScroll={false}
    >
      <div
        role="row"
        className="grid items-center border-b border-zinc-200 bg-zinc-100 px-3 py-2 text-xs font-medium text-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-400"
        style={{ gridTemplateColumns: gridTemplate, minWidth, gap, height: headerHeight }}
      >
        {/* Mandatory columns (not draggable) */}
        {columns
          .filter((c) => MANDATORY_COLUMN_IDS.has(c.id))
          .map((col) => (
            <div
              key={col.id}
              role="columnheader"
              className={cn("flex items-center overflow-hidden", col.align === "right" && "justify-end")}
            >
              <button
                onClick={() => col.sortable && onSort(col.id)}
                disabled={!col.sortable}
                aria-sort={sort.column === col.id ? (sort.direction === "asc" ? "ascending" : "descending") : undefined}
                className={cn(
                  "flex items-center gap-1 truncate transition-colors",
                  col.sortable && "hover:text-zinc-900 dark:hover:text-zinc-100",
                )}
              >
                <span className="truncate">{col.label}</span>
                {col.sortable &&
                  (sort.column === col.id ? (
                    sort.direction === "asc" ? (
                      <ChevronUp className="size-3 shrink-0" aria-hidden="true" />
                    ) : (
                      <ChevronDown className="size-3 shrink-0" aria-hidden="true" />
                    )
                  ) : (
                    <ChevronsUpDown className="size-3 shrink-0 opacity-30" aria-hidden="true" />
                  ))}
              </button>
            </div>
          ))}

        {/* Optional columns (draggable) */}
        <SortableContext items={optionalColumnIds} strategy={horizontalListSortingStrategy}>
          {columns
            .filter((c) => !MANDATORY_COLUMN_IDS.has(c.id))
            .map((col) => (
              <MemoizedSortableHeaderCell key={col.id} col={col} sort={sort} onSort={onSort} />
            ))}
        </SortableContext>
      </div>
    </DndContext>
  );
});

// =============================================================================
// Main Component
// =============================================================================

export function PoolsTable({ poolsData, isLoading, error, onRetry }: PoolsTableProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [hiddenSectionIndices, setHiddenSectionIndices] = useState<number[]>([]);

  // Layout dimensions from CSS custom properties
  const layout = useLayoutDimensions();
  // Layout dimensions from CSS (used for scroll position calculations)
  const { headerHeight, sectionHeight } = layout;

  // Store state
  const visibleColumnIds = usePoolsTableStore((s) => s.visibleColumnIds) as PoolColumnId[];
  const columnOrder = usePoolsTableStore((s) => s.columnOrder) as PoolColumnId[];
  const sort = usePoolsTableStore((s) => s.sort) as SortState<PoolColumnId>;
  const compactMode = usePoolsTableStore((s) => s.compactMode);
  const searchChips = usePoolsTableStore((s) => s.searchChips);
  const setSort = usePoolsTableStore((s) => s.setSort);
  const setColumnOrder = usePoolsTableStore((s) => s.setColumnOrder);

  const displayMode = usePoolsExtendedStore((s) => s.displayMode);
  const selectedPoolName = usePoolsExtendedStore((s) => s.selectedPoolName);
  const setSelectedPool = usePoolsExtendedStore((s) => s.setSelectedPool);

  // Safe pools data (empty when loading or error)
  const pools = poolsData?.pools ?? [];
  const sharingGroups = poolsData?.sharingGroups ?? [];

  // Get ordered visible columns
  const columns = useMemo(
    () => getOrderedColumns(COLUMN_MAP, columnOrder, visibleColumnIds),
    [columnOrder, visibleColumnIds],
  );

  // Grid template and min width
  const gridTemplate = useMemo(() => getGridTemplate(columns), [columns]);
  const minWidth = useMemo(() => getMinTableWidth(columns, DEFAULT_GAP), [columns]);

  // Optional column IDs (for DND)
  const optionalColumnIds = useMemo(
    () => columnOrder.filter((id) => !MANDATORY_COLUMN_IDS.has(id) && visibleColumnIds.includes(id)),
    [columnOrder, visibleColumnIds],
  );

  // Sharing groups map
  const sharingMap = useMemo(() => {
    const map = new Map<string, boolean>();
    for (const group of sharingGroups) {
      if (group.length > 1) {
        for (const poolName of group) {
          map.set(poolName, true);
        }
      }
    }
    return map;
  }, [sharingGroups]);

  // Filter pools
  const filteredPools = useMemo(() => {
    if (searchChips.length === 0) return pools;
    return filterByChips(pools, searchChips, POOL_SEARCH_FIELDS);
  }, [pools, searchChips]);

  // Group by status (use PoolStatus enum values as keys)
  const sections: StatusSection[] = useMemo(() => {
    const grouped = new Map<string, Pool[]>();
    for (const pool of filteredPools) {
      if (!grouped.has(pool.status)) grouped.set(pool.status, []);
      grouped.get(pool.status)!.push(pool);
    }

    return STATUS_ORDER.map((status) => {
      const display = getStatusDisplay(status);
      return {
        status: display.category,
        label: display.label,
        icon: display.icon,
        pools: sortPools(grouped.get(status) ?? [], sort),
      };
    }).filter((s) => s.pools.length > 0);
  }, [filteredPools, sort]);

  // Row height from CSS (scales with user font size preferences)
  const rowHeight = compactMode ? layout.rowHeightCompact : layout.rowHeight;

  // Calculate section start positions (for scroll tracking)
  const sectionStartPositions = useMemo(() => {
    const positions: number[] = [];
    let currentPosition = headerHeight; // Start after table header

    for (let i = 0; i < sections.length; i++) {
      positions.push(currentPosition);
      currentPosition += sectionHeight; // Section header
      currentPosition += sections[i].pools.length * rowHeight; // Pool rows
    }

    return positions;
  }, [sections, rowHeight, headerHeight, sectionHeight]);

  // Track which sections should appear in the bottom stack
  // A section joins the bottom stack when its inline position reaches where
  // the stack would render it (seamless handoff, no gap or pop)
  useEffect(() => {
    const scrollContainer = scrollRef.current;
    if (!scrollContainer || sections.length === 0) return;

    const handleScroll = () => {
      const scrollTop = scrollContainer.scrollTop;
      const viewportHeight = scrollContainer.clientHeight;

      // Calculate visual positions for all sections
      const visualPositions = sectionStartPositions.map((pos) => pos - scrollTop);

      // Determine which sections should be in the bottom stack
      // Work backwards from the last section to correctly calculate stack positions
      const hidden: number[] = [];

      // Iterate from last section to first
      for (let i = sections.length - 1; i >= 0; i--) {
        const sectionVisualTop = visualPositions[i];

        // This section's position in the bottom stack would be:
        // bottom: (number of sections after it that are in stack) * sectionHeight
        // Which means its top edge would be at:
        // viewportHeight - (hidden.length + 1) * sectionHeight
        const stackTopPosition = viewportHeight - (hidden.length + 1) * sectionHeight;

        // If section's inline position is at or below where stack would show it,
        // it should be in the stack (seamless handoff)
        if (sectionVisualTop >= stackTopPosition) {
          hidden.unshift(i); // Add to front to maintain order
        }
      }

      setHiddenSectionIndices(hidden);
    };

    // Initial check
    handleScroll();

    scrollContainer.addEventListener("scroll", handleScroll, { passive: true });
    return () => scrollContainer.removeEventListener("scroll", handleScroll);
  }, [sections.length, sectionStartPositions, sectionHeight]);

  // Handle sort change
  const handleSort = useCallback(
    (column: PoolColumnId) => {
      setSort(column as string);
    },
    [setSort],
  );

  // Handle column reorder
  const handleReorderColumns = useCallback(
    (newOptionalOrder: PoolColumnId[]) => {
      const mandatoryIds = columnOrder.filter((id) => MANDATORY_COLUMN_IDS.has(id));
      setColumnOrder([...mandatoryIds, ...newOptionalOrder]);
    },
    [columnOrder, setColumnOrder],
  );

  // Snappy scroll animation respecting reduced motion preference
  const smoothScrollTo = useCallback((element: HTMLElement, targetTop: number) => {
    // Respect user's reduced motion preference
    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (prefersReducedMotion) {
      // Instant scroll for reduced motion
      element.scrollTop = targetTop;
      return;
    }

    // Fast eased animation (150ms)
    const startTop = element.scrollTop;
    const distance = targetTop - startTop;
    const duration = 150; // ms - snappy!
    let startTime: number | null = null;

    const easeOutQuad = (t: number) => t * (2 - t); // Fast start, gentle end

    const animate = (currentTime: number) => {
      if (!startTime) startTime = currentTime;
      const elapsed = currentTime - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const easedProgress = easeOutQuad(progress);

      element.scrollTop = startTop + distance * easedProgress;

      if (progress < 1) {
        requestAnimationFrame(animate);
      }
    };

    requestAnimationFrame(animate);
  }, []);

  // Jump to section - scrolls to show the section's first pool row below stacked headers
  const scrollToSection = useCallback(
    (sectionIndex: number) => {
      const scrollContainer = scrollRef.current;
      if (!scrollContainer) return;

      // Calculate scroll position based on content heights:
      // - Table header height (sticky, doesn't count towards scroll)
      // - Previous sections' headers + their pool rows
      // - Current section's header

      // Height of all stacked headers when viewing this section:
      // = table header + all section headers up to and including this one
      const stackedHeadersHeight = headerHeight + (sectionIndex + 1) * sectionHeight;

      // Calculate content height before this section's first row:
      // = table header + previous sections (header + rows each)
      let contentBeforeFirstRow = headerHeight; // table header

      for (let i = 0; i < sectionIndex; i++) {
        contentBeforeFirstRow += sectionHeight; // section header
        contentBeforeFirstRow += sections[i].pools.length * rowHeight; // pool rows
      }
      contentBeforeFirstRow += sectionHeight; // current section's header

      // Scroll position = content position - stacked headers height
      // This places the first row right below the stacked headers
      const targetScroll = Math.max(0, contentBeforeFirstRow - stackedHeadersHeight);

      smoothScrollTo(scrollContainer, targetScroll);
    },
    [sections, rowHeight, smoothScrollTo, headerHeight, sectionHeight],
  );

  // Inline content based on state
  const renderInlineState = () => {
    if (isLoading) {
      return (
        <div className="flex flex-1 flex-col gap-2 p-4">
          {[1, 2, 3, 4, 5].map((i) => (
            <div
              key={i}
              className="h-12 animate-pulse rounded bg-zinc-100 dark:bg-zinc-800"
            />
          ))}
        </div>
      );
    }

    if (error) {
      return (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
          <div className="text-sm text-red-600 dark:text-red-400">
            Unable to load pools
          </div>
          <div className="text-xs text-zinc-500 dark:text-zinc-400">
            {error.message}
          </div>
          {onRetry && (
            <button
              onClick={onRetry}
              className="rounded-md bg-zinc-100 px-3 py-1.5 text-xs font-medium text-zinc-700 transition-colors hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
            >
              Try again
            </button>
          )}
        </div>
      );
    }

    if (sections.length === 0) {
      return (
        <div className="flex flex-1 items-center justify-center text-sm text-zinc-500 dark:text-zinc-400">
          {searchChips.length > 0
            ? "No pools match your filters"
            : "No pools available"}
        </div>
      );
    }

    return null;
  };

  const inlineState = renderInlineState();

  return (
    <div className="pools-table-container h-full overflow-hidden rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      {/* Unified scroll container - CSS handles scroll-behavior, scrollbar styling */}
      <div
        ref={scrollRef}
        className="pools-scroll-container flex-1 overflow-auto overscroll-contain"
        role="table"
        aria-label="Pools table"
      >
        <div style={{ minWidth }}>
          {/* Sticky table header (always visible, z-20) */}
          <div className="sticky top-0 z-20 touch-none" role="rowgroup">
            <TableHeader
              columns={columns}
              gridTemplate={gridTemplate}
              minWidth={minWidth}
              gap={DEFAULT_GAP}
              headerHeight={headerHeight}
              sort={sort}
              onSort={handleSort}
              optionalColumnIds={optionalColumnIds}
              onReorder={handleReorderColumns}
            />
          </div>

          {/* Inline states (loading/error/empty) or flattened sections */}
          {inlineState || (
            <div role="rowgroup">
              {/* Flatten structure: all section headers and rows as siblings for proper sticky stacking */}
              {sections.flatMap((section, sectionIndex) => [
                // Section header (sticky, CSS handles positioning via data-section-index)
                <SectionRow
                  key={`section-${section.status}`}
                  status={section.status}
                  label={section.label}
                  icon={section.icon}
                  count={section.pools.length}
                  sectionIndex={sectionIndex}
                  onJumpTo={() => scrollToSection(sectionIndex)}
                />,
                // Pool rows (CSS handles height via data-compact)
                ...section.pools.map((pool) => (
                  <PoolRow
                    key={pool.name}
                    pool={pool}
                    columns={columns}
                    gridTemplate={gridTemplate}
                    minWidth={minWidth}
                    gap={DEFAULT_GAP}
                    isSelected={selectedPoolName === pool.name}
                    onSelect={() => setSelectedPool(pool.name)}
                    displayMode={displayMode}
                    compact={compactMode}
                    isShared={sharingMap.has(pool.name)}
                  />
                )),
              ])}
            </div>
          )}
        </div>
      </div>

      {/* Bottom stack for sections below viewport (CSS handles positioning via data-stack-index) */}
      {!inlineState && sections.length > 1 && (
        <BottomSectionStack
          sections={sections}
          hiddenSectionIndices={hiddenSectionIndices}
          onJumpTo={scrollToSection}
        />
      )}
    </div>
  );
}

export default PoolsTable;
