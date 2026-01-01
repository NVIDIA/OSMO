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
 * Pools Toolbar Component
 *
 * Contains:
 * - Smart search with filter chips
 * - Display mode toggle (used/free)
 * - Compact mode toggle
 * - Column visibility menu
 */

"use client";

import { memo } from "react";
import { MonitorCheck, MonitorX, Rows3, Rows4, Columns } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { Pool } from "@/lib/api/adapter";
import { SmartSearch } from "@/components/ui/smart-search";
import { usePoolsTableStore, usePoolsExtendedStore } from "./stores/pools-table-store";
import { POOL_COLUMNS, MANDATORY_COLUMN_IDS } from "./pool-columns";
import { POOL_SEARCH_FIELDS } from "./pool-search-fields";

export interface PoolsToolbarProps {
  /** All pools for autocomplete suggestions */
  pools: Pool[];
}

export const PoolsToolbar = memo(function PoolsToolbar({ pools }: PoolsToolbarProps) {
  // Store state - use individual selectors for stable hook ordering
  const visibleColumnIds = usePoolsTableStore((s) => s.visibleColumnIds);
  const compactMode = usePoolsTableStore((s) => s.compactMode);
  const searchChips = usePoolsTableStore((s) => s.searchChips);
  const toggleColumn = usePoolsTableStore((s) => s.toggleColumn);
  const toggleCompactMode = usePoolsTableStore((s) => s.toggleCompactMode);
  const setSearchChips = usePoolsTableStore((s) => s.setSearchChips);

  const displayMode = usePoolsExtendedStore((s) => s.displayMode);
  const toggleDisplayMode = usePoolsExtendedStore((s) => s.toggleDisplayMode);

  // Optional columns (can be toggled)
  const optionalColumns = POOL_COLUMNS.filter((c) => !MANDATORY_COLUMN_IDS.has(c.id));

  return (
    <div className="flex flex-wrap items-center gap-3">
      {/* Smart Search */}
      <div className="min-w-[300px] flex-1">
        <SmartSearch
          data={pools}
          fields={POOL_SEARCH_FIELDS}
          chips={searchChips}
          onChipsChange={setSearchChips}
          placeholder="Search pools... (try 'status:online' or 'platform:dgx')"
        />
      </div>

      {/* Controls - simple icon buttons */}
      <div className="flex items-center gap-1">
        {/* Display Mode Toggle (Used/Free) */}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={toggleDisplayMode}
              className="rounded p-1.5 text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
            >
              {displayMode === "free" ? (
                <MonitorCheck className="size-4" />
              ) : (
                <MonitorX className="size-4" />
              )}
            </button>
          </TooltipTrigger>
          <TooltipContent>
            {displayMode === "free" ? "Show used" : "Show available"}
          </TooltipContent>
        </Tooltip>

        {/* Compact Mode Toggle */}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={toggleCompactMode}
              className="rounded p-1.5 text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
            >
              {compactMode ? <Rows4 className="size-4" /> : <Rows3 className="size-4" />}
            </button>
          </TooltipTrigger>
          <TooltipContent>{compactMode ? "Comfortable view" : "Compact view"}</TooltipContent>
        </Tooltip>

        {/* Column Visibility Menu */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className="rounded p-1.5 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800"
            >
              <Columns className="size-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuLabel>Columns</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {optionalColumns.map((column) => (
              <DropdownMenuCheckboxItem
                key={column.id}
                checked={visibleColumnIds.includes(column.id)}
                onCheckedChange={() => toggleColumn(column.id)}
              >
                {column.menuLabel ?? column.header}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
});
