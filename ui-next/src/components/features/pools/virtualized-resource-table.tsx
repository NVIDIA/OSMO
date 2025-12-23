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

import { useState, useRef, useEffect, useMemo, memo } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
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
} from "lucide-react";
import { cn, formatCompact } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ResourcePanel } from "./resource-panel";
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

interface VirtualizedResourceTableProps {
  /** Array of resources to display */
  resources: Resource[];
  /** Total count of resources before filtering (for "X of Y" display) */
  totalCount?: number;
  /** Show loading skeleton */
  isLoading?: boolean;
  /** Show the Pools column (for cross-pool views) */
  showPoolsColumn?: boolean;
  /** Pool context for ResourcePanel display */
  poolName?: string;
  /** Display mode: "free" shows available capacity, "used" shows utilization */
  displayMode?: ResourceDisplayMode;
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
}

// =============================================================================
// Layout Constants
// =============================================================================

const TABLE_GRID_COLUMNS_WITH_POOLS = "minmax(200px, 1fr) 120px 120px 80px 80px 100px 100px";
const TABLE_GRID_COLUMNS_NO_POOLS = "minmax(200px, 1fr) 120px 80px 80px 100px 100px";
const TABLE_MIN_WIDTH = 820;
const HEADER_HEIGHT = 41; // pixels

// =============================================================================
// Main Component
// =============================================================================

export function VirtualizedResourceTable({
  resources,
  totalCount,
  isLoading = false,
  showPoolsColumn = false,
  poolName,
  displayMode = "free",
  onResourceClick,
  filterContent,
  summaryContent,
  filterCount = 0,
  collapseThreshold = 0.5,
}: VirtualizedResourceTableProps) {
  const [selectedResource, setSelectedResource] = useState<Resource | null>(null);
  const [compactMode, setCompactMode] = useState(false);
  const [isPinned, setIsPinned] = useState(false);
  const [pinnedState, setPinnedState] = useState(false);
  const [isScrolled, setIsScrolled] = useState(false);
  const [autoCollapsed, setAutoCollapsed] = useState(false);

  // Sort state - includes displayMode to auto-reset when it changes
  const [sortState, setSortState] = useState<{ displayMode: string; sort: SortState }>({
    displayMode,
    sort: { column: null, direction: "asc" },
  });

  // Refs
  const scrollRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const filterContentRef = useRef<HTMLDivElement>(null);

  const gridColumns = showPoolsColumn ? TABLE_GRID_COLUMNS_WITH_POOLS : TABLE_GRID_COLUMNS_NO_POOLS;

  // Derive current sort, resetting if displayMode changed
  const sort = useMemo<SortState>(
    () =>
      sortState.displayMode === displayMode
        ? sortState.sort
        : { column: null, direction: "asc" },
    [sortState, displayMode]
  );

  const setSort = (newSort: SortState) => {
    setSortState({ displayMode, sort: newSort });
  };

  // Handle column header click
  const handleSort = (column: SortColumn) => {
    if (sort.column === column) {
      if (sort.direction === "asc") {
        setSort({ column, direction: "desc" });
      } else {
        setSort({ column: null, direction: "asc" });
      }
    } else {
      setSort({ column, direction: "asc" });
    }
  };

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
            displayMode === "free"
              ? a.gpu.total - a.gpu.used - (b.gpu.total - b.gpu.used)
              : a.gpu.used - b.gpu.used;
          break;
        case "cpu":
          cmp =
            displayMode === "free"
              ? a.cpu.total - a.cpu.used - (b.cpu.total - b.cpu.used)
              : a.cpu.used - b.cpu.used;
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

  // Handle row click
  const handleRowClick = (resource: Resource) => {
    if (onResourceClick) {
      onResourceClick(resource);
    } else {
      setSelectedResource(resource);
    }
  };

  // Row height based on compact mode
  const rowHeight = compactMode ? 32 : 48;

  // Scroll handling: shadow effect + horizontal sync
  useEffect(() => {
    const scroll = scrollRef.current;
    const header = headerRef.current;
    if (!scroll) return;

    let wasScrolled = false;
    const handleScroll = () => {
      const scrolled = scroll.scrollTop > 0;
      if (scrolled !== wasScrolled) {
        wasScrolled = scrolled;
        setIsScrolled(scrolled);
      }
      if (header) header.scrollLeft = scroll.scrollLeft;
    };

    scroll.addEventListener("scroll", handleScroll, { passive: true });
    return () => scroll.removeEventListener("scroll", handleScroll);
  }, []);

  // Auto-collapse when controls panel > threshold of container height
  // Uses hysteresis to prevent thrashing: collapse at threshold, expand at threshold - 10%
  // Only observes container size changes, not filter content (which changes when we collapse)
  useEffect(() => {
    const container = containerRef.current;
    const filterEl = filterContentRef.current;
    const tableHeader = headerRef.current;
    if (!container || !filterEl || !tableHeader) return;

    let debounceTimer: ReturnType<typeof setTimeout>;
    let isFirstMeasure = true;
    let lastContainerWidth = container.clientWidth;

    const measure = () => {
      // Skip auto-collapse on first measurement (initial page load)
      if (isFirstMeasure) {
        isFirstMeasure = false;
        return;
      }

      const containerH = container.clientHeight;
      const controlsPanelH = HEADER_HEIGHT + filterEl.scrollHeight + tableHeader.clientHeight;
      if (containerH > 0 && controlsPanelH > 0) {
        const ratio = controlsPanelH / containerH;
        // Hysteresis: collapse at threshold, but require 10% less to re-expand
        // This prevents oscillation when content is near the boundary
        setAutoCollapsed((wasCollapsed) => {
          if (wasCollapsed) {
            // To expand, ratio must be below (threshold - hysteresis)
            return ratio > (collapseThreshold - 0.1);
          } else {
            // To collapse, ratio must exceed threshold
            return ratio > collapseThreshold;
          }
        });
      }
    };

    const debouncedMeasure = () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(measure, 150); // Debounce to let layout settle
    };

    // Only observe container - not filterEl to avoid feedback loops
    // Filter content changes are a result of our own collapse action
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        // Only trigger on width changes (viewport resize), not height changes
        // Height changes are often caused by our own collapse/expand
        const newWidth = entry.contentRect.width;
        if (newWidth !== lastContainerWidth) {
          lastContainerWidth = newWidth;
          debouncedMeasure();
        }
      }
    });
    observer.observe(container);

    return () => {
      clearTimeout(debounceTimer);
      observer.disconnect();
    };
  }, [collapseThreshold]);

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
        style={{ contain: "strict" }}
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
                <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                  Filters & Summary
                </span>
                {filterCount > 0 && (
                  <span className="rounded-full bg-[var(--nvidia-green)] px-1.5 py-0.5 text-[10px] font-medium text-white">
                    {filterCount}
                  </span>
                )}
                <span className="text-zinc-300 dark:text-zinc-600">·</span>
                <span className="text-xs text-zinc-400 dark:text-zinc-500">
                  {totalCount !== undefined && totalCount !== resources.length
                    ? `${resources.length} of ${totalCount}`
                    : `${resources.length}`}
                </span>
                <span className="ml-auto text-zinc-400">
                  {effectiveCollapsed ? (
                    <Maximize2 className="h-3.5 w-3.5" />
                  ) : (
                    <Minimize2 className="h-3.5 w-3.5" />
                  )}
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
                          : "text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800"
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
                          ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                          : "text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800"
                      )}
                    >
                      {compactMode ? <Rows4 className="h-3.5 w-3.5" /> : <Rows3 className="h-3.5 w-3.5" />}
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>{compactMode ? "Comfortable view" : "Compact view"}</TooltipContent>
                </Tooltip>
              </div>
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
            <div className="min-h-0" style={{ overflow: effectiveCollapsed ? "hidden" : "visible" }}>
              <div
                ref={filterContentRef}
                id="filter-content"
                className="relative z-20 space-y-4 border-b border-zinc-100 bg-zinc-50/50 p-4 dark:border-zinc-800/50 dark:bg-zinc-900/30"
              >
                {filterContent}
                {summaryContent}
              </div>
            </div>
          </div>
        )}

        {/* Table Header - horizontal scroll synced with content */}
        <div
          ref={headerRef}
          className={cn(
            "relative z-10 scrollbar-none shrink-0 overflow-x-auto transition-shadow",
            "bg-[#f3f9e8] dark:bg-[#1a2e0a]",
            isScrolled && "shadow-md"
          )}
        >
          <div style={{ minWidth: TABLE_MIN_WIDTH }}>
            <TableHeaderRow
              compact={compactMode}
              showPoolsColumn={showPoolsColumn}
              sort={sort}
              onSort={handleSort}
              gridColumns={gridColumns}
            />
          </div>
        </div>

        {/* Table Content - virtualized with horizontal + vertical scroll */}
        <div ref={scrollRef} className="flex-1 overflow-auto" role="table" aria-label="Resources">
          <div style={{ minWidth: TABLE_MIN_WIDTH }}>
            <TableContent
              resources={sortedResources}
              isLoading={isLoading}
              displayMode={displayMode}
              showPoolsColumn={showPoolsColumn}
              scrollRef={scrollRef}
              rowHeight={rowHeight}
              gridColumns={gridColumns}
              onRowClick={handleRowClick}
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
        />
      )}
    </>
  );
}

// =============================================================================
// Sub-components
// =============================================================================

function TableHeaderRow({
  compact,
  showPoolsColumn,
  sort,
  onSort,
  gridColumns,
}: {
  compact: boolean;
  showPoolsColumn: boolean;
  sort: SortState;
  onSort: (column: SortColumn) => void;
  gridColumns: string;
}) {
  const columns: { label: string; column: SortColumn; align: "left" | "right" }[] = [
    { label: "Resource", column: "resource", align: "left" },
    ...(showPoolsColumn ? [{ label: "Pools", column: "pools" as SortColumn, align: "left" as const }] : []),
    { label: "Platform", column: "platform", align: "left" },
    { label: "GPU", column: "gpu", align: "right" },
    { label: "CPU", column: "cpu", align: "right" },
    { label: "Memory", column: "memory", align: "right" },
    { label: "Storage", column: "storage", align: "right" },
  ];

  return (
    <div
      className={cn(
        "grid gap-0 text-xs font-medium uppercase tracking-wider",
        "text-[var(--nvidia-green)] dark:text-[var(--nvidia-green-light)]",
        compact ? "py-1.5" : "py-2.5"
      )}
      style={{ gridTemplateColumns: gridColumns }}
    >
      {columns.map((col) => {
        const isActive = sort.column === col.column;
        return (
          <button
            key={col.column}
            onClick={() => onSort(col.column)}
            className={cn(
              "flex items-center gap-1 px-4 transition-colors hover:text-[var(--nvidia-green-dark)] dark:hover:text-white",
              col.align === "right" && "justify-end"
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
}

const TableContent = memo(function TableContent({
  resources,
  isLoading,
  displayMode,
  showPoolsColumn,
  scrollRef,
  rowHeight,
  gridColumns,
  onRowClick,
}: {
  resources: Resource[];
  isLoading: boolean;
  displayMode: ResourceDisplayMode;
  showPoolsColumn: boolean;
  scrollRef: React.RefObject<HTMLDivElement | null>;
  rowHeight: number;
  gridColumns: string;
  onRowClick: (resource: Resource) => void;
}) {
  "use no memo"; // Opt out of React Compiler - useVirtualizer returns functions that can't be memoized safely
  // eslint-disable-next-line react-hooks/incompatible-library -- intentionally opted out above
  const rowVirtualizer = useVirtualizer({
    count: resources.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowHeight,
    overscan: 5,
  });

  // Reset measurements when row height changes
  useEffect(() => {
    rowVirtualizer.measure();
  }, [rowHeight, rowVirtualizer]);

  if (isLoading) {
    return (
      <div>
        {[1, 2, 3, 4, 5].map((i) => (
          <div
            key={i}
            className="grid gap-0 border-b border-zinc-100 py-3 dark:border-zinc-800/50"
            style={{ gridTemplateColumns: gridColumns }}
          >
            <div className="px-4">
              <div className="h-4 w-40 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
            </div>
            {showPoolsColumn && (
              <div className="px-4">
                <div className="h-4 w-16 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
              </div>
            )}
            <div className="px-4">
              <div className="h-4 w-16 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
            </div>
            <div className="px-4">
              <div className="h-4 w-8 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
            </div>
            <div className="px-4">
              <div className="h-4 w-8 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
            </div>
            <div className="px-4">
              <div className="h-4 w-12 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
            </div>
            <div className="px-4">
              <div className="h-4 w-12 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (resources.length === 0) {
    return (
      <div className="p-8 text-center text-sm text-zinc-500 dark:text-zinc-400">
        No resources found
      </div>
    );
  }

  return (
    <div
      role="rowgroup"
      style={{
        height: rowVirtualizer.getTotalSize(),
        position: "relative",
        contain: "strict",
      }}
    >
      {rowVirtualizer.getVirtualItems().map((virtualRow) => {
        const resource = resources[virtualRow.index];
        return (
          <div
            key={virtualRow.key}
            role="row"
            tabIndex={0}
            onClick={() => onRowClick(resource)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onRowClick(resource);
              }
            }}
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: "100%",
              height: virtualRow.size,
              transform: `translateY(${virtualRow.start}px)`,
            }}
          >
            <div
              className="grid h-full cursor-pointer items-center gap-0 border-b border-zinc-100 text-sm transition-colors hover:bg-zinc-50 focus:bg-zinc-50 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-[var(--nvidia-green)] dark:border-zinc-800/50 dark:hover:bg-zinc-900 dark:focus:bg-zinc-900"
              style={{ gridTemplateColumns: gridColumns }}
            >
              <div className="truncate px-4 font-medium text-zinc-900 dark:text-zinc-100">
                {resource.name}
              </div>
              {showPoolsColumn && (
                <div className="truncate px-4 text-zinc-500 dark:text-zinc-400">
                  {resource.poolMemberships[0]?.pool ?? "—"}
                  {resource.poolMemberships.length > 1 && (
                    <span className="ml-1 text-xs text-zinc-400">
                      +{resource.poolMemberships.length - 1}
                    </span>
                  )}
                </div>
              )}
              <div className="truncate px-4 text-zinc-500 dark:text-zinc-400">
                {resource.platform}
              </div>
              <div className="whitespace-nowrap px-4 text-right tabular-nums">
                <CapacityCell used={resource.gpu.used} total={resource.gpu.total} mode={displayMode} />
              </div>
              <div className="whitespace-nowrap px-4 text-right tabular-nums">
                <CapacityCell used={resource.cpu.used} total={resource.cpu.total} mode={displayMode} />
              </div>
              <div className="whitespace-nowrap px-4 text-right tabular-nums">
                <CapacityCell
                  used={resource.memory.used}
                  total={resource.memory.total}
                  unit="Gi"
                  mode={displayMode}
                />
              </div>
              <div className="whitespace-nowrap px-4 text-right tabular-nums">
                <CapacityCell
                  used={resource.storage.used}
                  total={resource.storage.total}
                  unit="Gi"
                  mode={displayMode}
                />
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
});

function CapacityCell({
  used,
  total,
  unit = "",
  mode = "free",
}: {
  used: number;
  total: number;
  unit?: string;
  mode?: ResourceDisplayMode;
}) {
  if (total === 0) {
    return <span className="text-zinc-400 dark:text-zinc-600">—</span>;
  }

  const free = total - used;

  if (mode === "free") {
    return (
      <span className="text-zinc-900 dark:text-zinc-100">
        {formatCompact(free)}
        {unit && <span className="ml-0.5 text-xs text-zinc-400">{unit}</span>}
      </span>
    );
  }

  return (
    <span>
      <span className="text-zinc-900 dark:text-zinc-100">{formatCompact(used)}</span>
      <span className="text-zinc-400 dark:text-zinc-500">/{formatCompact(total)}</span>
      {unit && <span className="ml-0.5 text-xs text-zinc-400 dark:text-zinc-500">{unit}</span>}
    </span>
  );
}
