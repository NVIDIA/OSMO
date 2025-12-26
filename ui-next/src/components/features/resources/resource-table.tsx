/**
 * Copyright (c) 2025, NVIDIA CORPORATION. All rights reserved.
 *
 * NVIDIA CORPORATION and its licensors retain all intellectual property
 * and proprietary rights in and to this software, related documentation
 * and any modifications thereto. Any use, reproduction, disclosure or
 * distribution of this software and related documentation without an express
 * license agreement from NVIDIA CORPORATION is strictly prohibited.
 */

"use client";

import {
  useState,
  useRef,
  useEffect,
  useLayoutEffect,
  useMemo,
  memo,
  useCallback,
  isValidElement,
  cloneElement,
  startTransition,
} from "react";
import {
  Virtualizer,
  observeElementOffset,
  observeElementRect,
  elementScroll,
  type VirtualizerOptions,
} from "@tanstack/react-virtual";
import {
  Filter,
  Pin,
  PinOff,
  Rows3,
  Rows4,
  ChevronUp,
  ChevronDown,
  ChevronsUpDown,
  Minimize2,
  Maximize2,
  MonitorCheck,
  MonitorX,
} from "lucide-react";
import { cn, formatCompact, formatBytes, formatBytesPair } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ResourcePanel } from "./resource-panel";
import { LoadingMoreIndicator } from "@/components/shared/loading-more-indicator";
import type { Resource } from "@/lib/api/adapter";
import type { ResourceDisplayMode } from "@/headless";

// =============================================================================
// Types
// =============================================================================

type SortColumn = "resource" | "pools" | "platform" | "gpu" | "cpu" | "memory" | "storage";
type SortDirection = "asc" | "desc";

interface SortState {
  column: SortColumn | null;
  direction: SortDirection;
}

interface ResourceTableProps {
  /** Array of resources to display */
  resources: Resource[];
  /** Count matching current filters (the "X" in "X of Y") */
  filteredCount?: number;
  /** Total count before filters (the "Y" in "X of Y") */
  totalCount?: number;
  /** Show loading skeleton */
  isLoading?: boolean;
  /** Show the Pools column (for cross-pool views) */
  showPoolsColumn?: boolean;
  /** Pool context for ResourcePanel display */
  poolName?: string;
  /** Display mode: "free" shows available capacity, "used" shows utilization */
  displayMode?: ResourceDisplayMode;
  /** Callback when display mode changes (enables the toggle button in controls) */
  onDisplayModeChange?: (mode: ResourceDisplayMode) => void;
  /** Custom click handler for row selection */
  onResourceClick?: (resource: Resource) => void;
  /** Filter bar content (rendered in collapsible header) */
  filterContent?: React.ReactNode;
  /** Summary content (rendered below filters in collapsible header) */
  summaryContent?: React.ReactNode;
  /** Number of active filters (for badge display) */
  filterCount?: number;
  /** Collapse threshold (0-1). Default: 0.5 */
  collapseThreshold?: number;

  // === Infinite scroll props ===
  /** Whether more data is available to load */
  hasNextPage?: boolean;
  /** Function to load next page (called when scrolling near end) */
  onLoadMore?: () => void;
  /** Whether currently loading more data */
  isFetchingNextPage?: boolean;
}

// =============================================================================
// Layout Constants
// =============================================================================

import { defineColumns, selectColumns, COLUMN_MIN_WIDTHS, COLUMN_FLEX } from "@/lib/table-columns";

// Define all possible columns with semantic IDs
const ALL_COLUMNS = defineColumns([
  { id: "resource", minWidth: COLUMN_MIN_WIDTHS.TEXT_TRUNCATE, flex: COLUMN_FLEX.PRIMARY },
  { id: "pools", minWidth: COLUMN_MIN_WIDTHS.TEXT_SHORT, flex: COLUMN_FLEX.SECONDARY },
  { id: "platform", minWidth: COLUMN_MIN_WIDTHS.TEXT_SHORT, flex: COLUMN_FLEX.SECONDARY },
  { id: "gpu", minWidth: COLUMN_MIN_WIDTHS.NUMBER_SHORT, flex: COLUMN_FLEX.NUMERIC },
  { id: "cpu", minWidth: COLUMN_MIN_WIDTHS.NUMBER_SHORT, flex: COLUMN_FLEX.NUMERIC },
  { id: "memory", minWidth: COLUMN_MIN_WIDTHS.NUMBER_WITH_UNIT, flex: COLUMN_FLEX.NUMERIC_WIDE },
  { id: "storage", minWidth: COLUMN_MIN_WIDTHS.NUMBER_WITH_UNIT, flex: COLUMN_FLEX.NUMERIC_WIDE },
]);

// Column subsets for different views
const COLUMNS_WITH_POOLS = ALL_COLUMNS;
const COLUMNS_NO_POOLS = selectColumns(ALL_COLUMNS, ["resource", "platform", "gpu", "cpu", "memory", "storage"]);

const HEADER_HEIGHT = 41; // pixels

// =============================================================================
// Custom Virtualizer Hook (avoids flushSync)
// =============================================================================

/**
 * Custom useVirtualizer that never uses flushSync.
 * The library's default useVirtualizer uses flushSync for "sync" updates,
 * which crashes in React 18+ when called during render/lifecycle methods.
 * This version uses startTransition for all updates instead.
 */
function useVirtualizerNoFlushSync<TScrollElement extends Element, TItemElement extends Element>(
  options: Omit<
    VirtualizerOptions<TScrollElement, TItemElement>,
    "observeElementRect" | "observeElementOffset" | "scrollToFn"
  > & {
    observeElementRect?: VirtualizerOptions<TScrollElement, TItemElement>["observeElementRect"];
    observeElementOffset?: VirtualizerOptions<TScrollElement, TItemElement>["observeElementOffset"];
    scrollToFn?: VirtualizerOptions<TScrollElement, TItemElement>["scrollToFn"];
  },
): Virtualizer<TScrollElement, TItemElement> {
  const [, rerender] = useState({});

  const resolvedOptions: VirtualizerOptions<TScrollElement, TItemElement> = {
    observeElementRect,
    observeElementOffset,
    scrollToFn: elementScroll,
    ...options,
    // Override onChange to NEVER use flushSync - use startTransition instead
    onChange: (instance) => {
      startTransition(() => {
        rerender({});
      });
      options.onChange?.(instance, false); // Always pass false to downstream handlers
    },
  };

  const [instance] = useState(() => new Virtualizer<TScrollElement, TItemElement>(resolvedOptions));

  instance.setOptions(resolvedOptions);

  useLayoutEffect(() => {
    return instance._didMount();
  }, [instance]);

  useLayoutEffect(() => {
    return instance._willUpdate();
  });

  return instance;
}

// =============================================================================
// Main Component
// =============================================================================

export function ResourceTable({
  resources,
  filteredCount,
  totalCount,
  isLoading = false,
  showPoolsColumn = false,
  poolName,
  displayMode = "free",
  onDisplayModeChange,
  onResourceClick,
  filterContent,
  summaryContent,
  filterCount = 0,
  collapseThreshold = 0.5,
  hasNextPage = false,
  onLoadMore,
  isFetchingNextPage = false,
}: ResourceTableProps) {
  const [selectedResource, setSelectedResource] = useState<Resource | null>(null);
  const [compactMode, setCompactMode] = useState(false);
  const [isPinned, setIsPinned] = useState(false);
  const [pinnedState, setPinnedState] = useState(false);
  const [isScrolled, setIsScrolled] = useState(false);

  // Auto-collapse state machine: expanded/fullSummary → expanded/compactSummary → collapsed
  const [autoCollapsed, setAutoCollapsed] = useState(false);
  const [autoCompactSummary, setAutoCompactSummary] = useState(false);

  // Sort state - includes displayMode to auto-reset when it changes
  const [sortState, setSortState] = useState<{ displayMode: string; sort: SortState }>({
    displayMode,
    sort: { column: null, direction: "asc" },
  });

  // Refs
  const scrollRef = useRef<HTMLDivElement>(null);
  const tableHeaderRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const filterContentRef = useRef<HTMLDivElement>(null);
  const filterBarRef = useRef<HTMLDivElement>(null);
  const summaryRef = useRef<HTMLDivElement>(null);
  // Ref to track the last clicked row for focus restoration
  const lastClickedRowRef = useRef<HTMLElement | null>(null);

  // Select column configuration based on whether pools column is shown
  const columnConfig = showPoolsColumn ? COLUMNS_WITH_POOLS : COLUMNS_NO_POOLS;
  const gridColumns = columnConfig.gridTemplate;
  const tableMinWidth = columnConfig.minWidth;

  // Derive current sort, resetting if displayMode changed
  const sort = useMemo<SortState>(
    () => (sortState.displayMode === displayMode ? sortState.sort : { column: null, direction: "asc" }),
    [sortState, displayMode],
  );

  const setSort = useCallback(
    (newSortOrUpdater: SortState | ((prev: SortState) => SortState)) => {
      if (typeof newSortOrUpdater === "function") {
        setSortState((prevState) => ({
          displayMode,
          sort: newSortOrUpdater(
            prevState.displayMode === displayMode ? prevState.sort : { column: null, direction: "asc" },
          ),
        }));
      } else {
        setSortState({ displayMode, sort: newSortOrUpdater });
      }
    },
    [displayMode],
  );

  // Handle column header click - wrapped in startTransition for non-blocking updates
  const handleSort = useCallback(
    (column: SortColumn) => {
      startTransition(() => {
        setSort((prev) => {
          if (prev.column === column) {
            if (prev.direction === "asc") {
              return { column, direction: "desc" };
            } else {
              return { column: null, direction: "asc" };
            }
          } else {
            return { column, direction: "asc" };
          }
        });
      });
    },
    [setSort],
  );

  // Sort resources
  const sortedResources = useMemo(() => {
    if (!sort.column) return resources;

    const sorted = [...resources].sort((a, b) => {
      let cmp = 0;
      switch (sort.column) {
        case "resource":
          cmp = a.name.localeCompare(b.name);
          break;
        case "pools": {
          const aPool = a.poolMemberships[0]?.pool ?? "";
          const bPool = b.poolMemberships[0]?.pool ?? "";
          cmp = aPool.localeCompare(bPool);
          break;
        }
        case "platform":
          cmp = a.platform.localeCompare(b.platform);
          break;
        case "gpu":
          cmp =
            displayMode === "free" ? a.gpu.total - a.gpu.used - (b.gpu.total - b.gpu.used) : a.gpu.used - b.gpu.used;
          break;
        case "cpu":
          cmp =
            displayMode === "free" ? a.cpu.total - a.cpu.used - (b.cpu.total - b.cpu.used) : a.cpu.used - b.cpu.used;
          break;
        case "memory":
          cmp =
            displayMode === "free"
              ? a.memory.total - a.memory.used - (b.memory.total - b.memory.used)
              : a.memory.used - b.memory.used;
          break;
        case "storage":
          cmp =
            displayMode === "free"
              ? a.storage.total - a.storage.used - (b.storage.total - b.storage.used)
              : a.storage.used - b.storage.used;
          break;
      }
      return sort.direction === "asc" ? cmp : -cmp;
    });

    return sorted;
  }, [resources, sort, displayMode]);

  // Handle row click with focus tracking - memoized to prevent re-renders
  const handleRowClick = useCallback(
    (resource: Resource, rowElement?: HTMLElement) => {
      // Track the clicked element for focus restoration
      if (rowElement) {
        lastClickedRowRef.current = rowElement;
      }
      if (onResourceClick) {
        onResourceClick(resource);
      } else {
        setSelectedResource(resource);
      }
    },
    [onResourceClick],
  );

  // Row height based on compact mode
  const rowHeight = compactMode ? 32 : 48;

  // Scroll handling: shadow effect on sticky header
  useEffect(() => {
    const scroll = scrollRef.current;
    if (!scroll) return;

    let wasScrolled = false;
    const handleScroll = () => {
      const scrolled = scroll.scrollTop > 0;
      if (scrolled !== wasScrolled) {
        wasScrolled = scrolled;
        setIsScrolled(scrolled);
      }
    };

    scroll.addEventListener("scroll", handleScroll, { passive: true });
    return () => scroll.removeEventListener("scroll", handleScroll);
  }, []);

  // Deterministic auto-collapse: state is a pure function of dimensions
  // Given the same container dimensions, always produces the same layout
  //
  // State bands (based on controls panel height / container height ratio):
  //   ratio <= compactThreshold:     expanded + full summary
  //   compactThreshold < ratio <= collapseThreshold: expanded + compact summary
  //   ratio > collapseThreshold:     collapsed + compact summary
  //
  // To ensure determinism, we measure the filter bar and estimate summary heights
  // rather than measuring the current layout (which varies by state)
  useEffect(() => {
    const container = containerRef.current;
    const filterBar = filterBarRef.current;
    const tableHeader = tableHeaderRef.current;
    if (!container || !tableHeader) return;

    let debounceTimer: ReturnType<typeof setTimeout>;
    let isFirstMeasure = true;

    // Estimated heights for summary in each mode
    // These are approximate but consistent - actual CSS handles the details
    const FULL_SUMMARY_HEIGHT = 88; // 4-col grid with padding
    const COMPACT_SUMMARY_HEIGHT = 48; // inline 4-col compact

    const evaluateState = () => {
      const containerH = container.clientHeight;
      if (containerH <= 0) return;

      // Measure filter bar height (excludes summary)
      const filterBarH = filterBar?.scrollHeight ?? 0;
      const tableHeaderH = tableHeader.clientHeight;
      const paddingAndBorders = 32; // p-4 top/bottom + border

      // Calculate what the ratio WOULD BE in each state
      const baseHeight = HEADER_HEIGHT + filterBarH + tableHeaderH + paddingAndBorders;
      const fullRatio = (baseHeight + FULL_SUMMARY_HEIGHT) / containerH;
      const compactRatio = (baseHeight + COMPACT_SUMMARY_HEIGHT) / containerH;

      // Thresholds - compact band is 10% below collapse threshold
      const compactThreshold = collapseThreshold - 0.1;

      // Determine state deterministically based on what WOULD fit
      let newCollapsed: boolean;
      let newCompact: boolean;

      if (fullRatio <= compactThreshold) {
        // Full summary fits comfortably
        newCollapsed = false;
        newCompact = false;
      } else if (compactRatio <= collapseThreshold) {
        // Compact summary fits
        newCollapsed = false;
        newCompact = true;
      } else {
        // Nothing fits - collapse
        newCollapsed = true;
        newCompact = true;
      }

      // Update state only if changed
      if (newCollapsed !== autoCollapsed) setAutoCollapsed(newCollapsed);
      if (newCompact !== autoCompactSummary) setAutoCompactSummary(newCompact);
    };

    const debouncedEvaluate = () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        if (!isFirstMeasure) {
          evaluateState();
        }
      }, 100); // Short debounce - just to batch rapid resize events
    };

    // Observe container size changes
    const observer = new ResizeObserver(() => {
      debouncedEvaluate();
    });
    observer.observe(container);

    // Also observe filter bar for content changes (e.g., filter chips added/removed)
    if (filterBar) {
      observer.observe(filterBar);
    }

    // Initial evaluation after first paint (skip auto-collapse during SSR/hydration)
    const initialTimer = setTimeout(() => {
      isFirstMeasure = false;
      evaluateState();
    }, 100);

    return () => {
      clearTimeout(debounceTimer);
      clearTimeout(initialTimer);
      observer.disconnect();
    };
  }, [collapseThreshold, autoCollapsed, autoCompactSummary]);

  // Effective collapsed: pinned state takes precedence
  const effectiveCollapsed = isPinned ? pinnedState : autoCollapsed;

  // Toggle expand/collapse (pins if not already pinned)
  const handleToggle = () => {
    if (isPinned) {
      setPinnedState((prev) => !prev);
    } else {
      setIsPinned(true);
      setPinnedState(!autoCollapsed);
    }
  };

  // Toggle pin mode
  const handlePinToggle = () => {
    if (!isPinned) setPinnedState(effectiveCollapsed);
    setIsPinned(!isPinned);
  };

  // Don't render controls panel if no filter/summary content
  const hasControlsPanel = filterContent || summaryContent;

  return (
    <>
      <div
        ref={containerRef}
        className="flex h-full flex-col overflow-hidden rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950"
        style={{
          contain: "strict",
          // GPU acceleration for smoother scrolling
          transform: "translateZ(0)",
          willChange: "contents",
        }}
      >
        {/* Controls Panel Header */}
        {hasControlsPanel && (
          <div className="shrink-0 border-b border-zinc-100 bg-zinc-50/50 dark:border-zinc-800/50 dark:bg-zinc-900/30">
            <div className="flex items-center">
              {/* Clickable expand/collapse section */}
              <button
                onClick={handleToggle}
                aria-expanded={!effectiveCollapsed}
                aria-controls="filter-content"
                className="flex flex-1 items-center gap-2 px-4 py-2 text-left transition-colors hover:bg-zinc-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--nvidia-green)] dark:hover:bg-zinc-800/50"
              >
                <Filter className="h-3.5 w-3.5 text-zinc-400" />
                <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">Filters & Summary</span>
                {filterCount > 0 && (
                  <span className="rounded-full bg-[var(--nvidia-green)] px-1.5 py-0.5 text-[10px] font-medium text-white">
                    {filterCount}
                  </span>
                )}
                <span className="text-zinc-300 dark:text-zinc-600">·</span>
                <span className="text-xs text-zinc-400 dark:text-zinc-500">
                  {/* Show "X of Y" when filters are active, otherwise just total */}
                  {filterCount > 0 && filteredCount !== undefined && totalCount !== undefined
                    ? `${filteredCount} of ${totalCount}`
                    : `${totalCount ?? resources.length}`}
                </span>
                <span className="ml-auto text-zinc-400">
                  {effectiveCollapsed ? <Maximize2 className="h-3.5 w-3.5" /> : <Minimize2 className="h-3.5 w-3.5" />}
                </span>
              </button>

              {/* Pin/Unpin button */}
              <div className="border-l border-zinc-100 px-2 dark:border-zinc-800/50">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      onClick={handlePinToggle}
                      className={cn(
                        "rounded p-1.5 transition-colors",
                        isPinned
                          ? "bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300"
                          : "text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800",
                      )}
                    >
                      {isPinned ? <Pin className="h-3.5 w-3.5" /> : <PinOff className="h-3.5 w-3.5" />}
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>
                    {isPinned ? "Unpin (enable auto-collapse)" : "Pin (disable auto-collapse)"}
                  </TooltipContent>
                </Tooltip>
              </div>

              {/* Compact mode button */}
              <div className="border-l border-zinc-100 px-2 dark:border-zinc-800/50">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      onClick={() => setCompactMode((prev) => !prev)}
                      className={cn(
                        "rounded p-1.5 transition-colors",
                        compactMode
                          ? "bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300"
                          : "text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800",
                      )}
                    >
                      {compactMode ? <Rows4 className="h-3.5 w-3.5" /> : <Rows3 className="h-3.5 w-3.5" />}
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>{compactMode ? "Comfortable view" : "Compact view"}</TooltipContent>
                </Tooltip>
              </div>

              {/* Display mode toggle button (Used vs Available) */}
              {onDisplayModeChange && (
                <div className="border-l border-zinc-100 px-2 dark:border-zinc-800/50">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        onClick={() => onDisplayModeChange(displayMode === "free" ? "used" : "free")}
                        className={cn(
                          "rounded p-1.5 transition-colors",
                          displayMode === "used"
                            ? "bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300"
                            : "text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800",
                        )}
                      >
                        {displayMode === "used" ? (
                          <MonitorX className="h-3.5 w-3.5" />
                        ) : (
                          <MonitorCheck className="h-3.5 w-3.5" />
                        )}
                      </button>
                    </TooltipTrigger>
                    <TooltipContent>
                      {displayMode === "used" ? "Show available capacity" : "Show used capacity"}
                    </TooltipContent>
                  </Tooltip>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Controls Panel Content - always rendered for measurement */}
        {hasControlsPanel && (
          <div
            className="shrink-0 transition-[grid-template-rows] duration-150 ease-out"
            style={{
              display: "grid",
              gridTemplateRows: effectiveCollapsed ? "0fr" : "1fr",
            }}
            aria-hidden={effectiveCollapsed}
          >
            <div
              className="min-h-0"
              style={{ overflow: effectiveCollapsed ? "hidden" : "visible" }}
            >
              <div
                ref={filterContentRef}
                id="filter-content"
                className="relative z-20 space-y-4 border-b border-zinc-100 bg-zinc-50/50 p-4 dark:border-zinc-800/50 dark:bg-zinc-900/30"
              >
                {/* Filter bar - wrapped for measurement */}
                <div ref={filterBarRef}>{filterContent}</div>
                {/* Summary - wrapped for measurement, with forceCompact prop injected */}
                <div ref={summaryRef}>
                  {summaryContent && isValidElement(summaryContent)
                    ? cloneElement(summaryContent, { forceCompact: autoCompactSummary || effectiveCollapsed } as Record<
                        string,
                        unknown
                      >)
                    : summaryContent}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Table - single scroll container with sticky header */}
        {/* Grid columns defined once via CSS custom property, inherited by header and rows */}
        <div
          ref={scrollRef}
          className="flex-1 overflow-auto focus:outline-none scroll-optimized"
          role="table"
          aria-label="Resources"
          tabIndex={-1}
          style={
            {
              // Optimized scrolling
              overscrollBehavior: "contain",
              WebkitOverflowScrolling: "touch",
              // Single source of truth for column layout - used by header and all rows
              "--table-grid-columns": gridColumns,
            } as React.CSSProperties
          }
        >
          <div style={{ minWidth: tableMinWidth, contain: "layout" }}>
            {/* Sticky Header */}
            <div
              ref={tableHeaderRef}
              className={cn(
                "sticky top-0 z-10 transition-shadow",
                "bg-[var(--nvidia-green-bg)] dark:bg-[var(--nvidia-green-bg-dark)]",
                isScrolled && "shadow-md",
              )}
            >
              <TableHeaderRow
                compact={compactMode}
                showPoolsColumn={showPoolsColumn}
                sort={sort}
                onSort={handleSort}
              />
            </div>
            {/* Virtualized Body */}
            <TableContent
              resources={sortedResources}
              isLoading={isLoading}
              displayMode={displayMode}
              showPoolsColumn={showPoolsColumn}
              scrollRef={scrollRef}
              rowHeight={rowHeight}
              onRowClick={handleRowClick}
              hasNextPage={hasNextPage}
              onLoadMore={onLoadMore}
              isFetchingNextPage={isFetchingNextPage}
              totalCount={totalCount}
            />
          </div>
        </div>
      </div>

      {/* Resource detail panel - only render when not using custom handler */}
      {!onResourceClick && (
        <ResourcePanel
          resource={selectedResource}
          poolName={poolName}
          onClose={() => setSelectedResource(null)}
          restoreFocusRef={lastClickedRowRef}
          fallbackFocusRef={scrollRef}
        />
      )}
    </>
  );
}

// =============================================================================
// Sub-components
// =============================================================================

/**
 * Memoized table header - only re-renders when sort state or layout changes.
 * Uses CSS custom property --table-grid-columns from parent for column alignment.
 */
const TableHeaderRow = memo(function TableHeaderRow({
  compact,
  showPoolsColumn,
  sort,
  onSort,
}: {
  compact: boolean;
  showPoolsColumn: boolean;
  sort: SortState;
  onSort: (column: SortColumn) => void;
}) {
  // Memoize columns array to prevent recreation on each render
  const columns = useMemo(
    () => [
      { label: "Resource", column: "resource" as SortColumn, align: "left" as const },
      ...(showPoolsColumn ? [{ label: "Pools", column: "pools" as SortColumn, align: "left" as const }] : []),
      { label: "Platform", column: "platform" as SortColumn, align: "left" as const },
      { label: "GPU", column: "gpu" as SortColumn, align: "right" as const },
      { label: "CPU", column: "cpu" as SortColumn, align: "right" as const },
      { label: "Memory", column: "memory" as SortColumn, align: "right" as const },
      { label: "Storage", column: "storage" as SortColumn, align: "right" as const },
    ],
    [showPoolsColumn],
  );

  return (
    <div
      className={cn(
        "grid gap-0 text-xs font-medium uppercase tracking-wider",
        "text-[var(--nvidia-green)] dark:text-[var(--nvidia-green-light)]",
        compact ? "py-1.5" : "py-2.5",
      )}
      style={{ gridTemplateColumns: "var(--table-grid-columns)", contain: "layout style" }}
    >
      {columns.map((col) => {
        const isActive = sort.column === col.column;
        return (
          <button
            key={col.column}
            onClick={() => onSort(col.column)}
            className={cn(
              "flex items-center gap-1 px-4 transition-colors hover:text-[var(--nvidia-green-dark)] dark:hover:text-white focus-optimized",
              col.align === "right" && "justify-end",
            )}
          >
            {col.label}
            {isActive ? (
              sort.direction === "asc" ? (
                <ChevronUp className="h-3 w-3" />
              ) : (
                <ChevronDown className="h-3 w-3" />
              )
            ) : (
              <ChevronsUpDown className="h-3 w-3 opacity-30" />
            )}
          </button>
        );
      })}
    </div>
  );
});

/**
 * Virtualized table content.
 * Uses CSS custom property --table-grid-columns from parent for column alignment.
 */
const TableContent = memo(function TableContent({
  resources,
  isLoading,
  displayMode,
  showPoolsColumn,
  scrollRef,
  rowHeight,
  onRowClick,
  hasNextPage = false,
  onLoadMore,
  isFetchingNextPage = false,
  totalCount,
}: {
  resources: Resource[];
  isLoading: boolean;
  displayMode: ResourceDisplayMode;
  showPoolsColumn: boolean;
  scrollRef: React.RefObject<HTMLDivElement | null>;
  rowHeight: number;
  onRowClick: (resource: Resource, rowElement?: HTMLElement) => void;
  hasNextPage?: boolean;
  onLoadMore?: () => void;
  isFetchingNextPage?: boolean;
  totalCount?: number;
}) {
  "use no memo"; // Opt out of React Compiler - useVirtualizer returns functions that can't be memoized safely

  const rowVirtualizer = useVirtualizerNoFlushSync({
    count: resources.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowHeight,
    overscan: 5,
  });

  // Reset measurements when row height changes
  useEffect(() => {
    rowVirtualizer.measure();
  }, [rowHeight, rowVirtualizer]);

  // Trigger load more when scrolling near bottom
  // Uses scroll event listener since virtualizer's internal state changes on scroll
  // but the virtualizer instance itself doesn't change (so useEffect deps won't trigger)
  useEffect(() => {
    const scrollElement = scrollRef.current;
    if (!scrollElement || !onLoadMore) return;

    const checkLoadMore = () => {
      if (!hasNextPage || isFetchingNextPage) return;

      const virtualItems = rowVirtualizer.getVirtualItems();
      const lastItem = virtualItems.at(-1);

      if (!lastItem) return;

      // Load more when within 10 items of end
      const threshold = 10;
      if (lastItem.index >= resources.length - threshold) {
        onLoadMore();
      }
    };

    // Check on scroll
    scrollElement.addEventListener("scroll", checkLoadMore, { passive: true });

    // Also check immediately in case we're already near the bottom
    checkLoadMore();

    return () => {
      scrollElement.removeEventListener("scroll", checkLoadMore);
    };
  }, [scrollRef, rowVirtualizer, resources.length, hasNextPage, isFetchingNextPage, onLoadMore]);

  if (isLoading) {
    return (
      <div style={{ contain: "content" }}>
        {[1, 2, 3, 4, 5].map((i) => (
          <div
            key={i}
            className="grid gap-0 border-b border-zinc-100 py-3 dark:border-zinc-800/50"
            style={{ gridTemplateColumns: "var(--table-grid-columns)", contain: "layout style" }}
          >
            <div className="px-4">
              <div className="h-4 w-40 skeleton-shimmer rounded" />
            </div>
            {showPoolsColumn && (
              <div className="px-4">
                <div className="h-4 w-16 skeleton-shimmer rounded" />
              </div>
            )}
            <div className="px-4">
              <div className="h-4 w-16 skeleton-shimmer rounded" />
            </div>
            <div className="px-4">
              <div className="h-4 w-8 skeleton-shimmer rounded" />
            </div>
            <div className="px-4">
              <div className="h-4 w-8 skeleton-shimmer rounded" />
            </div>
            <div className="px-4">
              <div className="h-4 w-12 skeleton-shimmer rounded" />
            </div>
            <div className="px-4">
              <div className="h-4 w-12 skeleton-shimmer rounded" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (resources.length === 0) {
    return <div className="p-8 text-center text-sm text-zinc-500 dark:text-zinc-400">No resources found</div>;
  }

  return (
    <>
      <div
        role="rowgroup"
        style={{
          height: rowVirtualizer.getTotalSize(),
          position: "relative",
          contain: "strict",
          // Isolate paint operations
          isolation: "isolate",
        }}
      >
        {rowVirtualizer.getVirtualItems().map((virtualRow) => {
          const resource = resources[virtualRow.index];
          return (
            <div
              key={virtualRow.key}
              role="row"
              tabIndex={0}
              onClick={(e) => onRowClick(resource, e.currentTarget)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onRowClick(resource, e.currentTarget);
                }
              }}
              className="virtual-item"
              style={{
                height: virtualRow.size,
                // GPU-accelerated transform instead of top positioning
                transform: `translate3d(0, ${virtualRow.start}px, 0)`,
              }}
            >
              <div
                className="grid h-full cursor-pointer items-center gap-0 border-b border-zinc-100 text-sm transition-[background-color] duration-150 hover:bg-zinc-50 focus:bg-zinc-50 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-[var(--nvidia-green)] dark:border-zinc-800/50 dark:hover:bg-zinc-900 dark:focus:bg-zinc-900"
                style={{ gridTemplateColumns: "var(--table-grid-columns)", contain: "layout style" }}
              >
                <div className="truncate px-4 font-medium text-zinc-900 dark:text-zinc-100">{resource.name}</div>
                {showPoolsColumn && (
                  <div className="truncate px-4 text-zinc-500 dark:text-zinc-400">
                    {resource.poolMemberships[0]?.pool ?? "—"}
                    {resource.poolMemberships.length > 1 && (
                      <span className="ml-1 text-xs text-zinc-400">+{resource.poolMemberships.length - 1}</span>
                    )}
                  </div>
                )}
                <div className="truncate px-4 text-zinc-500 dark:text-zinc-400">{resource.platform}</div>
                <div className="whitespace-nowrap px-4 text-right tabular-nums">
                  <CapacityCell
                    used={resource.gpu.used}
                    total={resource.gpu.total}
                    mode={displayMode}
                  />
                </div>
                <div className="whitespace-nowrap px-4 text-right tabular-nums">
                  <CapacityCell
                    used={resource.cpu.used}
                    total={resource.cpu.total}
                    mode={displayMode}
                  />
                </div>
                <div className="whitespace-nowrap px-4 text-right tabular-nums">
                  <CapacityCell
                    used={resource.memory.used}
                    total={resource.memory.total}
                    isBytes
                    mode={displayMode}
                  />
                </div>
                <div className="whitespace-nowrap px-4 text-right tabular-nums">
                  <CapacityCell
                    used={resource.storage.used}
                    total={resource.storage.total}
                    isBytes
                    mode={displayMode}
                  />
                </div>
              </div>
            </div>
          );
        })}
      </div>
      {/* Loading/end indicator - outside virtualized container to be visible */}
      <LoadingMoreIndicator
        isLoading={isFetchingNextPage}
        hasMore={hasNextPage}
        loadedCount={resources.length}
        totalCount={totalCount}
      />
    </>
  );
});

/**
 * Memoized capacity cell - prevents re-renders when values haven't changed.
 * Uses shallow comparison for props.
 *
 * For memory/storage (isBytes=true), uses conventional binary units (Ki, Mi, Gi, Ti).
 * When showing used/total, both use the same (more granular) unit for consistency.
 * For other resources, uses compact number formatting.
 */
const CapacityCell = memo(function CapacityCell({
  used,
  total,
  isBytes = false,
  mode = "free",
}: {
  used: number;
  total: number;
  /** If true, values are in GiB and will be formatted with appropriate binary unit */
  isBytes?: boolean;
  mode?: ResourceDisplayMode;
}) {
  if (total === 0) {
    return <span className="text-zinc-400 dark:text-zinc-600">—</span>;
  }

  // For bytes, use pair formatting to ensure consistent units
  if (isBytes) {
    if (mode === "free") {
      const free = total - used;
      const formatted = formatBytes(free);
      return (
        <span className="text-zinc-900 dark:text-zinc-100">
          {formatted.value}
          <span className="ml-0.5 text-xs text-zinc-400">{formatted.unit}</span>
        </span>
      );
    }

    // Used/total mode: use consistent units
    const pair = formatBytesPair(used, total);
    return (
      <span>
        <span className="text-zinc-900 dark:text-zinc-100">{pair.used}</span>
        <span className="text-zinc-400 dark:text-zinc-500">/{pair.total}</span>
        <span className="ml-0.5 text-xs text-zinc-400 dark:text-zinc-500">{pair.unit}</span>
      </span>
    );
  }

  // Non-bytes: use compact formatting
  const free = total - used;

  if (mode === "free") {
    return <span className="text-zinc-900 dark:text-zinc-100">{formatCompact(free)}</span>;
  }

  return (
    <span>
      <span className="text-zinc-900 dark:text-zinc-100">{formatCompact(used)}</span>
      <span className="text-zinc-400 dark:text-zinc-500">/{formatCompact(total)}</span>
    </span>
  );
});
