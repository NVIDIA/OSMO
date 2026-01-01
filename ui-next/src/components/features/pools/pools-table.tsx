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
 * Pools Table Component
 *
 * UNIFIED table with sticky headers:
 * - Table header: always sticky at top
 * - Section rows (Online/Maintenance/Offline): sticky while scrolling their content
 * - All rows in ONE scroll container for natural section header push behavior
 *
 * Layout:
 * ┌────────────────────────────────────────────────┐
 * │ TABLE HEADER (always sticky)                   │
 * ├────────────────────────────────────────────────┤
 * │ 🟢 Online (5)         <- sticky while in section
 * │ pool-1 row                                     │
 * │ pool-2 row                                     │
 * │ 🟡 Maintenance (2)    <- pushes Online header up
 * │ pool-3 row                                     │
 * │ 🔴 Offline (1)        <- pushes Maintenance up │
 * │ pool-4 row                                     │
 * └────────────────────────────────────────────────┘
 */

"use client";

import { useMemo, useCallback, useRef, Fragment } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { card } from "@/lib/styles";
import type { Pool, PoolsResponse } from "@/lib/api/adapter";
import { filterByChips, type SearchChip } from "@/components/ui/smart-search";
import { usePoolsTableStore, usePoolsExtendedStore } from "./stores/pools-table-store";
import { PoolsTableHeader } from "./pools-table-header";
import { PoolsTableRow } from "./pools-table-row";
import { getGridTemplate, getMinTableWidth } from "./pool-columns";
import { POOL_SEARCH_FIELDS } from "./pool-search-fields";
import { STATUS_ORDER, getStatusDisplay, LAYOUT } from "./constants";
import "./pools.css";

// =============================================================================
// Types
// =============================================================================

interface PoolSection {
  status: string;
  label: string;
  icon: string;
  pools: Pool[];
}

/** A flattened row for virtualization/rendering - either a section header or a pool row */
type FlatRow =
  | { type: "section"; status: string; label: string; icon: string; count: number }
  | { type: "pool"; pool: Pool };

export interface PoolsTableProps {
  /** Pools response with pools and sharing info */
  poolsData: PoolsResponse;
  /** Loading state */
  isLoading?: boolean;
}

// =============================================================================
// Helper: Flatten sections into rows
// =============================================================================

function flattenSections(
  pools: Pool[],
  searchChips: SearchChip[],
  collapsedSections: string[],
): FlatRow[] {
  // Filter pools by search chips
  const filteredPools = filterByChips(pools, searchChips, POOL_SEARCH_FIELDS);

  const rows: FlatRow[] = [];

  for (const status of STATUS_ORDER) {
    const statusPools = filteredPools.filter((p) => p.status === status);

    if (statusPools.length === 0) continue;

    const display = getStatusDisplay(status);
    const isCollapsed = collapsedSections.includes(status);

    // Add section header row
    rows.push({
      type: "section",
      status,
      label: display.label,
      icon: display.icon,
      count: statusPools.length,
    });

    // Add pool rows if not collapsed
    if (!isCollapsed) {
      for (const pool of statusPools) {
        rows.push({ type: "pool", pool });
      }
    }
  }

  return rows;
}

// =============================================================================
// Helper: Build sharing lookup
// =============================================================================

function buildSharingLookup(sharingGroups: string[][]): Set<string> {
  const shared = new Set<string>();
  for (const group of sharingGroups) {
    if (group.length > 1) {
      for (const name of group) {
        shared.add(name);
      }
    }
  }
  return shared;
}

// =============================================================================
// Section Header Row Component
// =============================================================================

interface SectionRowProps {
  status: string;
  label: string;
  icon: string;
  count: number;
  isCollapsed: boolean;
  onToggle: () => void;
}

function SectionRow({ status, label, icon, count, isCollapsed, onToggle }: SectionRowProps) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={cn(
        "pools-section-row",
        "flex w-full items-center gap-2 px-3 py-2",
        "bg-zinc-100 dark:bg-zinc-800",
        "border-b border-zinc-200 dark:border-zinc-700",
        "text-left text-sm font-medium",
        "hover:bg-zinc-200/70 dark:hover:bg-zinc-700/70",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-inset",
      )}
      aria-expanded={!isCollapsed}
    >
      {isCollapsed ? (
        <ChevronRight className="size-4 text-zinc-400" />
      ) : (
        <ChevronDown className="size-4 text-zinc-400" />
      )}
      <span>{icon}</span>
      <span className="text-zinc-900 dark:text-zinc-100">{label}</span>
      <span className="text-zinc-500 dark:text-zinc-400">({count})</span>
    </button>
  );
}

// =============================================================================
// Main Component
// =============================================================================

export function PoolsTable({ poolsData, isLoading }: PoolsTableProps) {
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Store state - use individual selectors for stable hook ordering
  const visibleColumnIds = usePoolsTableStore((s) => s.visibleColumnIds);
  const columnOrder = usePoolsTableStore((s) => s.columnOrder);
  const columnUserWidths = usePoolsTableStore((s) => s.columnUserWidths);
  const sort = usePoolsTableStore((s) => s.sort);
  const compactMode = usePoolsTableStore((s) => s.compactMode);
  const collapsedSections = usePoolsTableStore((s) => s.collapsedSections);
  const searchChips = usePoolsTableStore((s) => s.searchChips);
  const setSort = usePoolsTableStore((s) => s.setSort);
  const setColumnOrder = usePoolsTableStore((s) => s.setColumnOrder);
  const toggleSection = usePoolsTableStore((s) => s.toggleSection);

  const displayMode = usePoolsExtendedStore((s) => s.displayMode);
  const selectedPoolName = usePoolsExtendedStore((s) => s.selectedPoolName);
  const setSelectedPool = usePoolsExtendedStore((s) => s.setSelectedPool);

  // Compute grid template
  const gridTemplate = useMemo(
    () => getGridTemplate(visibleColumnIds, columnOrder, columnUserWidths),
    [visibleColumnIds, columnOrder, columnUserWidths],
  );

  const minWidth = useMemo(() => getMinTableWidth(visibleColumnIds, columnOrder), [visibleColumnIds, columnOrder]);

  // Flatten pools into rows (sections + pools)
  const flatRows = useMemo(
    () => flattenSections(poolsData.pools, searchChips, collapsedSections),
    [poolsData.pools, searchChips, collapsedSections],
  );

  // Build sharing lookup
  const sharedPools = useMemo(() => buildSharingLookup(poolsData.sharingGroups), [poolsData.sharingGroups]);

  // Handlers
  const handleSelectPool = useCallback(
    (name: string) => {
      setSelectedPool(selectedPoolName === name ? null : name);
    },
    [selectedPoolName, setSelectedPool],
  );

  const handleToggleSection = useCallback(
    (status: string) => {
      toggleSection(status);
    },
    [toggleSection],
  );

  const rowHeight = compactMode ? LAYOUT.ROW_HEIGHT_COMPACT : LAYOUT.ROW_HEIGHT;

  if (isLoading) {
    return (
      <div className={cn(card.base, "flex h-full min-h-[400px] items-center justify-center p-8")}>
        <div className="size-8 animate-spin rounded-full border-4 border-zinc-200 border-t-blue-500" />
      </div>
    );
  }

  const hasContent = flatRows.length > 0;

  if (!hasContent) {
    return (
      <div className={cn(card.base, "flex h-full min-h-[400px] items-center justify-center p-8 text-center")}>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          {searchChips.length > 0 ? "No pools match your filters" : "No pools available"}
        </p>
      </div>
    );
  }

  return (
    <div className={cn(card.base, "pools-table-container flex h-full min-h-[400px] flex-col overflow-hidden")}>
      {/* Table Header - always sticky at top=0 */}
      <div
        className="pools-table-header shrink-0 sticky top-0 z-20"
        style={{ minWidth }}
      >
        <PoolsTableHeader
          visibleColumnIds={visibleColumnIds}
          columnOrder={columnOrder}
          gridTemplate={gridTemplate}
          minWidth={minWidth}
          sort={sort}
          onSort={setSort}
          onColumnOrderChange={setColumnOrder}
        />
      </div>

      {/* Scrollable content area - fills remaining space */}
      <div
        ref={scrollContainerRef}
        className="pools-scroll-area min-h-0 flex-1 overflow-auto bg-white dark:bg-zinc-900"
        style={{ minWidth }}
      >
        {/* Flattened rows: section headers + pool rows */}
        {flatRows.map((row, index) => {
          if (row.type === "section") {
            return (
              <SectionRow
                key={`section-${row.status}`}
                status={row.status}
                label={row.label}
                icon={row.icon}
                count={row.count}
                isCollapsed={collapsedSections.includes(row.status)}
                onToggle={() => handleToggleSection(row.status)}
              />
            );
          }

          // Pool row
          return (
            <PoolsTableRow
              key={row.pool.name}
              pool={row.pool}
              gridTemplate={gridTemplate}
              minWidth={minWidth}
              isSelected={selectedPoolName === row.pool.name}
              visibleColumnIds={visibleColumnIds}
              columnOrder={columnOrder}
              displayMode={displayMode}
              compact={compactMode}
              isShared={sharedPools.has(row.pool.name)}
              onClick={() => handleSelectPool(row.pool.name)}
            />
          );
        })}
      </div>
    </div>
  );
}
