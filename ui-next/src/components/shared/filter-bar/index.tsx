// Copyright (c) 2025, NVIDIA CORPORATION. All rights reserved.
//
// NVIDIA CORPORATION and its licensors retain all intellectual property
// and proprietary rights in and to this software, related documentation
// and any modifications thereto. Any use, reproduction, disclosure or
// distribution of this software and related documentation without an express
// license agreement from NVIDIA CORPORATION is strictly prohibited.

"use client";

import { createContext, useContext, type ReactNode } from "react";
import { Filter, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { chip } from "@/lib/styles";

// Re-export sub-components
export { FilterSearch } from "./filter-search";
export { FilterMultiSelect } from "./filter-multi-select";
export { FilterSingleSelect } from "./filter-single-select";
export { FilterToggle } from "./filter-toggle";
export { FilterActions } from "./filter-actions";

// =============================================================================
// Types
// =============================================================================

/**
 * Generic active filter representation.
 * Each filter type can define its own shape, but must have these fields.
 */
export interface ActiveFilter<T extends string = string> {
  /** Unique key for this filter (e.g., "platform", "status") */
  type: T;
  /** The filter value */
  value: string;
  /** Human-readable label for the chip */
  label: string;
}

interface FilterBarContextValue<T extends string = string> {
  /** Currently active filters */
  activeFilters: ActiveFilter<T>[];
  /** Remove a specific filter */
  onRemoveFilter: (filter: ActiveFilter<T>) => void;
  /** Clear all filters */
  onClearAll: () => void;
}

const FilterBarContext = createContext<FilterBarContextValue | null>(null);

export function useFilterBarContext() {
  const context = useContext(FilterBarContext);
  if (!context) {
    throw new Error("FilterBar sub-components must be used within FilterBar");
  }
  return context;
}

// =============================================================================
// FilterBar Container
// =============================================================================

interface FilterBarProps<T extends string = string> {
  /** Active filters to display as removable chips */
  activeFilters: ActiveFilter<T>[];
  /** Callback when a filter chip is removed */
  onRemoveFilter: (filter: ActiveFilter<T>) => void;
  /** Callback to clear all filters */
  onClearAll: () => void;
  /** Filter components (Search, MultiSelect, etc.) */
  children: ReactNode;
  /** Additional class name */
  className?: string;
}

/**
 * Composable filter bar container.
 *
 * Use with sub-components:
 * - FilterBar.Search - Text search input
 * - FilterBar.MultiSelect - Multi-select dropdown with checkboxes
 * - FilterBar.SingleSelect - Single-select dropdown with radio buttons
 * - FilterBar.Toggle - Segmented toggle button
 * - FilterBar.Actions - Right-aligned actions container
 *
 * @example
 * ```tsx
 * <FilterBar activeFilters={filters} onRemoveFilter={remove} onClearAll={clear}>
 *   <FilterBar.Search value={search} onChange={setSearch} />
 *   <FilterBar.MultiSelect label="Platform" options={platforms} ... />
 *   <FilterBar.Actions>
 *     <FilterBar.Toggle label="View by" ... />
 *   </FilterBar.Actions>
 * </FilterBar>
 * ```
 */
export function FilterBar<T extends string = string>({
  activeFilters,
  onRemoveFilter,
  onClearAll,
  children,
  className,
}: FilterBarProps<T>) {
  const hasFilters = activeFilters.length > 0;

  // Cast to base type for context (React Context doesn't support generics)
  const contextValue = {
    activeFilters: activeFilters as ActiveFilter[],
    onRemoveFilter: onRemoveFilter as (filter: ActiveFilter) => void,
    onClearAll,
  };

  return (
    <FilterBarContext.Provider value={contextValue}>
      <div className={cn("space-y-3", className)}>
        {/* Filter controls row */}
        <div className="flex flex-wrap items-center gap-3">{children}</div>

        {/* Active filter chips - WCAG 2.1 accessible */}
        {hasFilters && (
          <div
            className="flex flex-wrap items-center gap-2"
            role="region"
            aria-label="Active filters"
          >
            <Filter
              className="h-3.5 w-3.5 text-zinc-400"
              aria-hidden="true"
            />
            {activeFilters.map((filter) => (
              <button
                key={`${filter.type}-${filter.value}`}
                onClick={() => onRemoveFilter(filter)}
                aria-label={`Remove filter: ${getFilterLabel(filter)}`}
                className={cn(
                  "group flex items-center gap-1.5 rounded-full border py-0.5 pl-2.5 pr-1.5 text-xs transition-colors",
                  chip.selected,
                )}
              >
                <span>{getFilterLabel(filter)}</span>
                <span
                  className="flex h-4 w-4 items-center justify-center rounded-full bg-black/10 transition-colors group-hover:bg-black/20 dark:bg-white/10 dark:group-hover:bg-white/20"
                  aria-hidden="true"
                >
                  <X className="h-2.5 w-2.5" />
                </span>
              </button>
            ))}
            {activeFilters.length > 1 && (
              <button
                onClick={onClearAll}
                aria-label={`Clear all ${activeFilters.length} filters`}
                className="text-xs text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
              >
                Clear all
              </button>
            )}
          </div>
        )}
      </div>
    </FilterBarContext.Provider>
  );
}

// =============================================================================
// Helpers
// =============================================================================

function getFilterLabel(filter: ActiveFilter): string {
  if (filter.type === "search") {
    return `Search: ${filter.label}`;
  }
  return filter.label;
}

// =============================================================================
// Compound Component Pattern - Attach sub-components
// =============================================================================

import { FilterSearch } from "./filter-search";
import { FilterMultiSelect } from "./filter-multi-select";
import { FilterSingleSelect } from "./filter-single-select";
import { FilterToggle } from "./filter-toggle";
import { FilterActions } from "./filter-actions";

FilterBar.Search = FilterSearch;
FilterBar.MultiSelect = FilterMultiSelect;
FilterBar.SingleSelect = FilterSingleSelect;
FilterBar.Toggle = FilterToggle;
FilterBar.Actions = FilterActions;
