// Copyright (c) 2025, NVIDIA CORPORATION. All rights reserved.
//
// NVIDIA CORPORATION and its licensors retain all intellectual property
// and proprietary rights in and to this software, related documentation
// and any modifications thereto. Any use, reproduction, disclosure or
// distribution of this software and related documentation without an express
// license agreement from NVIDIA CORPORATION is strictly prohibited.

"use client";

import { useState, useRef, useEffect, useMemo, memo } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Cpu, Box, Layers, Filter, Rows3, Rows4, Pin, PinOff, Zap, MemoryStick, HardDrive, ChevronUp, ChevronDown, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { FilterBar, ApiError } from "@/components/shared";
import { useAllResources } from "@/headless";

// Table layout constants
const TABLE_GRID_COLUMNS = "minmax(200px, 1fr) 120px 120px 80px 80px 100px 100px";
const TABLE_MIN_WIDTH = 820; // pixels

// =============================================================================
// Main Page Component
// =============================================================================

// Sort configuration
type SortKey = "name" | "pool" | "platform" | "gpu" | "cpu" | "memory" | "storage";
type SortDirection = "asc" | "desc";

export default function LongTableUXPage() {
  // UI state
  const [compactMode, setCompactMode] = useState(false);
  const [isPinned, setIsPinned] = useState(false); // When pinned, ignore auto-collapse
  const [pinnedState, setPinnedState] = useState(false); // The pinned expanded/collapsed state
  const [isScrolled, setIsScrolled] = useState(false); // For shadow effect on header
  const [autoCollapsed, setAutoCollapsed] = useState(false); // For responsive auto-collapse

  // Sort state
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");

  // Options for tuning
  const [collapseThreshold, setCollapseThreshold] = useState(50); // percentage
  const [showOptions, setShowOptions] = useState(true);

  // Refs
  const scrollRef = useRef<HTMLDivElement>(null); // Scroll container for table content
  const headerRef = useRef<HTMLDivElement>(null); // Table header (horizontal scroll sync)
  const containerRef = useRef<HTMLDivElement>(null); // Main container for height measurement
  const filterContentRef = useRef<HTMLDivElement>(null); // Filter content for height measurement

  // Use the real resources hook
  const {
    pools,
    platforms,
    resourceTypes,
    filteredResources,
    search,
    setSearch,
    clearSearch,
    selectedPools,
    togglePool,
    clearPoolFilter,
    selectedPlatforms,
    togglePlatform,
    clearPlatformFilter,
    selectedResourceTypes,
    toggleResourceType,
    displayMode,
    setDisplayMode,
    activeFilters,
    removeFilter,
    clearAllFilters,
    filterCount,
    isLoading,
    error,
    refetch,
  } = useAllResources();

  // Duplicate resources 10x for testing long tables
  const multipliedResources = useMemo(() => {
    const result = [];
    for (let i = 0; i < 10; i++) {
      result.push(
        ...filteredResources.map((r) => ({
          ...r,
          name: i === 0 ? r.name : `${r.name}-copy-${i}`,
          hostname: i === 0 ? r.hostname : `${r.hostname}-copy-${i}`,
        }))
      );
    }
    return result;
  }, [filteredResources]);

  // Sort resources
  const sortedResources = useMemo(() => {
    const sorted = [...multipliedResources];
    sorted.sort((a, b) => {
      let aVal: string | number;
      let bVal: string | number;

      switch (sortKey) {
        case "name":
          aVal = a.name.toLowerCase();
          bVal = b.name.toLowerCase();
          break;
        case "pool":
          aVal = a.poolMemberships[0]?.pool ?? "";
          bVal = b.poolMemberships[0]?.pool ?? "";
          break;
        case "platform":
          aVal = a.platform;
          bVal = b.platform;
          break;
        case "gpu":
          aVal = a.gpu.total - a.gpu.used;
          bVal = b.gpu.total - b.gpu.used;
          break;
        case "cpu":
          aVal = a.cpu.total - a.cpu.used;
          bVal = b.cpu.total - b.cpu.used;
          break;
        case "memory":
          aVal = a.memory.total - a.memory.used;
          bVal = b.memory.total - b.memory.used;
          break;
        case "storage":
          aVal = a.storage.total - a.storage.used;
          bVal = b.storage.total - b.storage.used;
          break;
        default:
          return 0;
      }

      if (aVal < bVal) return sortDirection === "asc" ? -1 : 1;
      if (aVal > bVal) return sortDirection === "asc" ? 1 : -1;
      return 0;
    });
    return sorted;
  }, [multipliedResources, sortKey, sortDirection]);

  // Handle sort toggle
  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDirection(prev => prev === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDirection("asc");
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
      // Only update state if changed (avoid unnecessary re-renders)
      const scrolled = scroll.scrollTop > 0;
      if (scrolled !== wasScrolled) {
        wasScrolled = scrolled;
        setIsScrolled(scrolled);
      }
      // Sync horizontal scroll (direct DOM, no React)
      if (header) header.scrollLeft = scroll.scrollLeft;
    };

    scroll.addEventListener("scroll", handleScroll, { passive: true });
    return () => scroll.removeEventListener("scroll", handleScroll);
  }, []);

  // Auto-collapse when controls panel > 50% of container height
  // Skip initial render to avoid collapsing before user sees the page
  useEffect(() => {
    const container = containerRef.current;
    const filterContent = filterContentRef.current;
    const tableHeader = headerRef.current;
    if (!container || !filterContent || !tableHeader) return;

    let rafId: number;
    let isFirstMeasure = true;

    const measure = () => {
      // Skip auto-collapse on first measurement (initial page load)
      if (isFirstMeasure) {
        isFirstMeasure = false;
        return;
      }

      const containerH = container.clientHeight;
      const controlsPanelH = 41 + filterContent.scrollHeight + tableHeader.clientHeight;
      if (containerH > 0 && controlsPanelH > 0) {
        setAutoCollapsed(controlsPanelH > containerH * (collapseThreshold / 100));
      }
    };

    // Initial measurement
    rafId = requestAnimationFrame(measure);

    // Observe size changes
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(measure);
    });
    observer.observe(container);
    observer.observe(filterContent);

    return () => {
      cancelAnimationFrame(rafId);
      observer.disconnect();
    };
  }, [collapseThreshold]);

  // Effective collapsed: pinned state takes precedence
  const effectiveCollapsed = isPinned ? pinnedState : autoCollapsed;

  // Toggle expand/collapse (pins if not already pinned)
  const handleToggle = () => {
    if (isPinned) {
      setPinnedState(prev => !prev);
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

  return (
    <div className="flex h-full flex-col gap-3">
      {/* Options Panel */}
      {showOptions && (
        <div className="shrink-0 rounded-lg border border-dashed border-blue-300 bg-blue-50 p-3 dark:border-blue-700 dark:bg-blue-950/30">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-medium text-blue-700 dark:text-blue-300">🧪 UX Options</span>
            <button onClick={() => setShowOptions(false)} className="text-xs text-blue-500 hover:text-blue-700">Hide</button>
          </div>
          <div className="flex flex-wrap gap-4 text-xs">
            <span className="text-zinc-600 dark:text-zinc-400">Summary: CSS Container Query (auto-adapts)</span>
            <label className="flex items-center gap-2">
              <span className="text-zinc-600 dark:text-zinc-400">Collapse at:</span>
              <select
                value={collapseThreshold}
                onChange={(e) => setCollapseThreshold(Number(e.target.value))}
                className="rounded border border-zinc-300 bg-white px-2 py-1 text-xs dark:border-zinc-600 dark:bg-zinc-800"
              >
                <option value={30}>30%</option>
                <option value={40}>40%</option>
                <option value={50}>50%</option>
                <option value={60}>60%</option>
                <option value={70}>70%</option>
              </select>
            </label>
          </div>
        </div>
      )}

      {/* Main Container */}
      <div
        ref={containerRef}
        className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950"
        style={{ contain: "strict" }}
      >
        {/* Filter Header - subtle background tint for visual separation */}
        <div className="shrink-0 border-b border-zinc-100 bg-zinc-50/50 dark:border-zinc-800/50 dark:bg-zinc-900/30">
        <div className="flex items-center">
          <button
            onClick={handleToggle}
            aria-expanded={!effectiveCollapsed}
            aria-controls="filter-content"
            className="flex flex-1 items-center justify-between px-4 py-2 text-left transition-colors hover:bg-zinc-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--nvidia-green)] dark:hover:bg-zinc-900/50"
          >
            <div className="flex items-center gap-2">
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
                {effectiveCollapsed ? "click to expand" : "click to collapse"}
              </span>
            </div>
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

      {/* Filter Content - always rendered for measurement, CSS Grid for smooth GPU-accelerated transition */}
      <div
        className="grid shrink-0 transition-[grid-template-rows] duration-150 ease-out"
        style={{ gridTemplateRows: effectiveCollapsed ? "0fr" : "1fr" }}
        aria-hidden={effectiveCollapsed}
      >
        <div className="min-h-0 overflow-hidden">
          <div
            ref={filterContentRef}
            id="filter-content"
            className="space-y-4 border-b border-zinc-100 bg-zinc-50/50 p-4 dark:border-zinc-800/50 dark:bg-zinc-900/30"
          >
            <FilterBar activeFilters={activeFilters} onRemoveFilter={removeFilter} onClearAll={clearAllFilters}>
              <FilterBar.Search value={search} onChange={setSearch} onClear={clearSearch} placeholder="Search resources..." />
              {pools.length > 0 && (
                <FilterBar.MultiSelect icon={Layers} label="Pool" options={pools} selected={selectedPools} onToggle={togglePool} onClear={clearPoolFilter} searchable searchPlaceholder="Search pools..." />
              )}
              {platforms.length > 0 && (
                <FilterBar.MultiSelect icon={Cpu} label="Platform" options={platforms} selected={selectedPlatforms} onToggle={togglePlatform} onClear={clearPlatformFilter} searchable searchPlaceholder="Search platforms..." />
              )}
              {resourceTypes.length > 0 && (
                <FilterBar.SingleSelect icon={Box} label="Type" options={resourceTypes} value={[...selectedResourceTypes][0]} onChange={toggleResourceType} />
              )}
              <FilterBar.Actions>
                <FilterBar.Toggle label="View by" options={[{ value: "free" as const, label: "Free" }, { value: "used" as const, label: "Used" }]} value={displayMode} onChange={setDisplayMode} />
              </FilterBar.Actions>
            </FilterBar>
            {!error && (
              <SummaryDisplay
                resources={filteredResources}
                displayMode={displayMode}
                isLoading={isLoading}
              />
            )}
          </div>
        </div>
      </div>

      {/* Table Header - horizontal scroll synced with content */}
      <div
        ref={headerRef}
        className={cn(
          "scrollbar-none shrink-0 overflow-x-auto transition-shadow",
          "bg-[#f3f9e8] dark:bg-[#1a2e0a]",
          isScrolled && "shadow-md"
        )}
      >
        <div style={{ minWidth: TABLE_MIN_WIDTH }}>
          <TableHeaderRow
            compact={compactMode}
            sortKey={sortKey}
            sortDirection={sortDirection}
            onSort={handleSort}
          />
        </div>
      </div>

      {/* Table Content - horizontal + vertical scroll */}
      <div ref={scrollRef} className="flex-1 overflow-auto">
        <div style={{ minWidth: TABLE_MIN_WIDTH }}>
          <TableContent
            resources={sortedResources}
            isLoading={isLoading}
            error={error}
            refetch={refetch}
            displayMode={displayMode}
            scrollRef={scrollRef}
            rowHeight={rowHeight}
          />
        </div>
      </div>
      </div>
    </div>
  );
}

// =============================================================================
// Sub-components (memoized to prevent unnecessary re-renders)
// =============================================================================

// Adaptive Summary - uses CSS container queries for responsive layout
function SummaryDisplay({
  resources,
  displayMode,
  isLoading,
}: {
  resources: ReturnType<typeof useAllResources>["filteredResources"];
  displayMode: "free" | "used";
  isLoading: boolean;
}) {
  // Calculate totals
  const totals = useMemo(() => {
    return resources.reduce(
      (acc, r) => ({
        gpu: { used: acc.gpu.used + r.gpu.used, total: acc.gpu.total + r.gpu.total },
        cpu: { used: acc.cpu.used + r.cpu.used, total: acc.cpu.total + r.cpu.total },
        memory: { used: acc.memory.used + r.memory.used, total: acc.memory.total + r.memory.total },
        storage: { used: acc.storage.used + r.storage.used, total: acc.storage.total + r.storage.total },
      }),
      { gpu: { used: 0, total: 0 }, cpu: { used: 0, total: 0 }, memory: { used: 0, total: 0 }, storage: { used: 0, total: 0 } }
    );
  }, [resources]);

  const format = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));
  const getValue = (m: { used: number; total: number }) => (displayMode === "free" ? m.total - m.used : m.used);

  if (isLoading) {
    return <div className="h-8 animate-pulse rounded bg-zinc-100 dark:bg-zinc-800" />;
  }

  const metrics = [
    { Icon: Zap, label: "GPU", value: totals.gpu, color: "text-amber-500" },
    { Icon: Cpu, label: "CPU", value: totals.cpu, color: "text-blue-500" },
    { Icon: MemoryStick, label: "Memory", value: totals.memory, unit: "GB", color: "text-purple-500" },
    { Icon: HardDrive, label: "Storage", value: totals.storage, unit: "GB", color: "text-emerald-500" },
  ];

  return (
    // Container query wrapper - @container queries check this element's width
    <div className="@container">
      {/* Grid: 2 col (narrow) → 4 col (wide) */}
      <div className="grid grid-cols-2 gap-2 @[500px]:gap-3 @[500px]:grid-cols-4 transition-all duration-200">
        {metrics.map((item, i) => (
          <div
            key={i}
            className="group rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950 transition-all duration-200 p-2 @[500px]:p-3"
          >
            {/* Compact mode (<500px): single row with icon + value */}
            {/* Wide mode (≥500px): stacked with header row */}
            <div className="flex items-center gap-2 @[500px]:flex-col @[500px]:items-start @[500px]:gap-0 transition-all duration-200">
              {/* Icon + Label (label only visible in wide mode) */}
              <div className="flex items-center gap-2 @[500px]:mb-1">
                <item.Icon className={cn("h-4 w-4 shrink-0", item.color)} />
                <span className="hidden @[500px]:inline text-xs font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                  {item.label}
                </span>
              </div>

              {/* Value */}
              <div className="flex items-baseline gap-1 flex-wrap">
                <span className="text-xl font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">
                  {format(getValue(item.value))}
                </span>
                {displayMode === "used" && (
                  <span className="text-sm text-zinc-400 dark:text-zinc-500">
                    / {format(item.value.total)}
                  </span>
                )}
                {item.unit && (
                  <span className="text-xs text-zinc-400 dark:text-zinc-500 ml-0.5">
                    {item.unit}
                  </span>
                )}
                <span className="text-xs text-zinc-400 dark:text-zinc-500 ml-1">
                  {displayMode === "free" ? "free" : "used"}
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

const TableContent = memo(function TableContent({
  resources,
  isLoading,
  error,
  refetch,
  displayMode,
  scrollRef,
  rowHeight,
}: {
  resources: ReturnType<typeof useAllResources>["filteredResources"];
  isLoading: boolean;
  error: ReturnType<typeof useAllResources>["error"];
  refetch: () => void;
  displayMode: "free" | "used";
  scrollRef: React.RefObject<HTMLDivElement | null>;
  rowHeight: number;
}) {
  // Virtual list setup
  const rowVirtualizer = useVirtualizer({
    count: resources.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowHeight,
    overscan: 5, // Reduced for better memory usage while maintaining smooth scroll
  });

  // Reset measurements when row height changes
  useEffect(() => {
    rowVirtualizer.measure();
  }, [rowHeight, rowVirtualizer]);
  if (error) {
    return (
      <div className="p-4">
        <ApiError
          error={error}
          onRetry={refetch}
          title="Unable to load resources"
          authAware
          loginMessage="You need to log in to view resources."
        />
      </div>
    );
  }

  if (isLoading) {
    return (
      <div>
        {[1, 2, 3, 4, 5].map((i) => (
          <div
            key={i}
            className="grid gap-0 border-b border-zinc-100 py-3 dark:border-zinc-800/50"
            style={{ gridTemplateColumns: TABLE_GRID_COLUMNS }}
          >
            <div className="px-4"><div className="h-4 w-40 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" /></div>
            <div className="px-4"><div className="h-4 w-16 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" /></div>
            <div className="px-4"><div className="h-4 w-16 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" /></div>
            <div className="px-4"><div className="h-4 w-8 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" /></div>
            <div className="px-4"><div className="h-4 w-8 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" /></div>
            <div className="px-4"><div className="h-4 w-12 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" /></div>
            <div className="px-4"><div className="h-4 w-12 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" /></div>
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
      style={{
        height: rowVirtualizer.getTotalSize(),
        position: "relative",
        contain: "strict", // Isolate layout/paint
      }}
    >
      {rowVirtualizer.getVirtualItems().map((virtualRow) => {
        const resource = resources[virtualRow.index];
        return (
          <div
            key={virtualRow.key}
            data-index={virtualRow.index}
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
              className="grid h-full cursor-pointer items-center gap-0 border-b border-zinc-100 text-sm transition-colors hover:bg-zinc-50 dark:border-zinc-800/50 dark:hover:bg-zinc-900"
              style={{ gridTemplateColumns: TABLE_GRID_COLUMNS }}
            >
              <div className="truncate px-4 font-medium text-zinc-900 dark:text-zinc-100">
                {resource.name}
              </div>
              <div className="truncate px-4 text-zinc-500 dark:text-zinc-400">
                {resource.poolMemberships[0]?.pool ?? "—"}
                {resource.poolMemberships.length > 1 && (
                  <span className="ml-1 text-xs text-zinc-400">
                    +{resource.poolMemberships.length - 1}
                  </span>
                )}
              </div>
              <div className="truncate px-4 text-zinc-500 dark:text-zinc-400">
                {resource.platform}
              </div>
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

function TableHeaderRow({
  compact,
  sortKey,
  sortDirection,
  onSort
}: {
  compact: boolean;
  sortKey: SortKey;
  sortDirection: SortDirection;
  onSort: (key: SortKey) => void;
}) {
  const columns: { label: string; key: SortKey; align: "left" | "right" }[] = [
    { label: "Resource", key: "name", align: "left" },
    { label: "Pools", key: "pool", align: "left" },
    { label: "Platform", key: "platform", align: "left" },
    { label: "GPU", key: "gpu", align: "right" },
    { label: "CPU", key: "cpu", align: "right" },
    { label: "Memory", key: "memory", align: "right" },
    { label: "Storage", key: "storage", align: "right" },
  ];

  return (
    <div
      className={cn(
        "grid gap-0 text-xs font-medium uppercase tracking-wider",
        "text-[var(--nvidia-green)] dark:text-[var(--nvidia-green-light)]",
        compact ? "py-1.5" : "py-2.5"
      )}
      style={{ gridTemplateColumns: TABLE_GRID_COLUMNS }}
    >
      {columns.map((col) => {
        const isActive = sortKey === col.key;
        return (
          <button
            key={col.key}
            onClick={() => onSort(col.key)}
            className={cn(
              "flex items-center gap-1 px-4 transition-colors hover:text-[var(--nvidia-green-dark)] dark:hover:text-white",
              col.align === "right" && "justify-end"
            )}
          >
            {col.label}
            {isActive ? (
              sortDirection === "asc" ? (
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

function CapacityCell({
  used,
  total,
  unit = "",
  mode = "free",
}: {
  used: number;
  total: number;
  unit?: string;
  mode?: "free" | "used";
}) {
  if (total === 0) {
    return <span className="text-zinc-400 dark:text-zinc-600">—</span>;
  }

  const free = total - used;

  if (mode === "free") {
    return (
      <span className="text-zinc-900 dark:text-zinc-100">
        {free}
        {unit && <span className="ml-0.5 text-xs text-zinc-400">{unit}</span>}
      </span>
    );
  }

  return (
    <span>
      <span className="text-zinc-900 dark:text-zinc-100">{used}</span>
      <span className="text-zinc-400 dark:text-zinc-500">/{total}</span>
      {unit && (
        <span className="ml-0.5 text-xs text-zinc-400 dark:text-zinc-500">
          {unit}
        </span>
      )}
    </span>
  );
}
