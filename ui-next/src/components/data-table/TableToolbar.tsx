// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION. All rights reserved.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
//
// SPDX-License-Identifier: Apache-2.0

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
} from "@/components/shadcn/dropdown-menu";
import { Toggle } from "@/components/shadcn/toggle";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/shadcn/tooltip";
import { useSharedPreferences, type SearchChip } from "@/stores";
import { SmartSearch, type SearchField, type SearchPreset, type ResultsCount } from "@/components/smart-search";

// =============================================================================
// Types
// =============================================================================

export interface ColumnDefinition {
  id: string;
  label: string;
  menuLabel?: string;
}

export interface TableToolbarProps<T> {
  /** Data for SmartSearch autocomplete */
  data: T[];
  /** Search field definitions */
  searchFields: readonly SearchField<T>[];
  /** Column definitions for visibility dropdown */
  columns: ColumnDefinition[];
  /** Currently visible column IDs */
  visibleColumnIds: string[];
  /** Callback to toggle column visibility */
  onToggleColumn: (id: string) => void;
  /** Current search chips */
  searchChips: SearchChip[];
  /** Callback when chips change */
  onSearchChipsChange: (chips: SearchChip[]) => void;
  /** SmartSearch placeholder text */
  placeholder?: string;
  /** Preset filter buttons for SmartSearch dropdown */
  searchPresets?: {
    label: string;
    items: SearchPreset[];
  }[];
  /** Show the free/used display mode toggle (default: true) */
  showDisplayModeToggle?: boolean;
  /** Additional content to render after standard controls */
  children?: React.ReactNode;
  /**
   * Results count for displaying "N results" or "M of N results".
   * Backend-driven: total is the unfiltered count, filtered is the count after filters.
   */
  resultsCount?: ResultsCount;
}

// =============================================================================
// Component
// =============================================================================

/**
 * TableToolbar - Shared toolbar for data tables.
 *
 * Provides:
 * - SmartSearch with chip filtering
 * - Display mode toggle (free/used)
 * - Compact mode toggle
 * - Column visibility dropdown
 *
 * @example
 * ```tsx
 * <TableToolbar
 *   data={pools}
 *   searchFields={poolSearchFields}
 *   columns={OPTIONAL_COLUMNS}
 *   visibleColumnIds={visibleColumnIds}
 *   onToggleColumn={toggleColumn}
 *   searchChips={searchChips}
 *   onSearchChipsChange={setSearchChips}
 *   placeholder="Search pools..."
 * />
 * ```
 */
function TableToolbarInner<T>({
  data,
  searchFields,
  columns,
  visibleColumnIds,
  onToggleColumn,
  searchChips,
  onSearchChipsChange,
  placeholder = "Search...",
  searchPresets,
  showDisplayModeToggle = true,
  children,
  resultsCount,
}: TableToolbarProps<T>) {
  // Shared preferences (across pools & resources)
  const compactMode = useSharedPreferences((s) => s.compactMode);
  const toggleCompactMode = useSharedPreferences((s) => s.toggleCompactMode);
  const displayMode = useSharedPreferences((s) => s.displayMode);
  const toggleDisplayMode = useSharedPreferences((s) => s.toggleDisplayMode);

  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="min-w-[300px] flex-1">
        <SmartSearch
          data={data}
          fields={searchFields}
          chips={searchChips}
          onChipsChange={onSearchChipsChange}
          placeholder={placeholder}
          presets={searchPresets}
          resultsCount={resultsCount}
        />
      </div>

      <div className="flex items-center gap-1">
        {showDisplayModeToggle && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Toggle
                size="sm"
                pressed={displayMode === "free"}
                onPressedChange={toggleDisplayMode}
                aria-label={displayMode === "free" ? "Show used" : "Show available"}
              >
                {displayMode === "free" ? <MonitorCheck className="size-4" /> : <MonitorX className="size-4" />}
              </Toggle>
            </TooltipTrigger>
            <TooltipContent>{displayMode === "free" ? "Show used" : "Show available"}</TooltipContent>
          </Tooltip>
        )}

        <Tooltip>
          <TooltipTrigger asChild>
            <Toggle
              size="sm"
              pressed={compactMode}
              onPressedChange={toggleCompactMode}
              aria-label={compactMode ? "Comfortable view" : "Compact view"}
            >
              {compactMode ? <Rows4 className="size-4" /> : <Rows3 className="size-4" />}
            </Toggle>
          </TooltipTrigger>
          <TooltipContent>{compactMode ? "Comfortable view" : "Compact view"}</TooltipContent>
        </Tooltip>

        <DropdownMenu>
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>
                <Toggle
                  size="sm"
                  aria-label="Toggle columns"
                >
                  <Columns className="size-4" />
                </Toggle>
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent>Toggle columns</TooltipContent>
          </Tooltip>
          <DropdownMenuContent
            align="end"
            className="w-48"
          >
            <DropdownMenuLabel>Columns</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {columns.map((column) => (
              <DropdownMenuCheckboxItem
                key={column.id}
                checked={visibleColumnIds.includes(column.id)}
                onCheckedChange={() => onToggleColumn(column.id)}
                onSelect={(e) => e.preventDefault()}
              >
                {column.menuLabel ?? column.label}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        {children}
      </div>
    </div>
  );
}

// Memoize with generic type support
export const TableToolbar = memo(TableToolbarInner) as typeof TableToolbarInner;
