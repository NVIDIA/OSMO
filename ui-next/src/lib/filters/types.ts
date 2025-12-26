/**
 * SPDX-FileCopyrightText: Copyright (c) 2025 NVIDIA CORPORATION. All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Generic filter types for building filterable lists.
 *
 * These types provide a consistent interface for filter state management
 * across different entity types (resources, pools, workflows, tasks, etc.).
 */

// =============================================================================
// Set Filter Types
// =============================================================================

/**
 * Options for configuring a set-based filter.
 */
export interface SetFilterOptions {
  /**
   * If true, only one value can be selected at a time.
   * Selecting a new value deselects the previous one.
   * Selecting the same value again deselects it.
   */
  singleSelect?: boolean;
}

/**
 * Result from useSetFilter hook.
 * Provides state and handlers for a set-based filter.
 *
 * @template T - The type of values in the filter set
 */
export interface SetFilterResult<T> {
  /** Currently selected values */
  selected: Set<T>;
  /** Toggle a value in/out of the selection */
  toggle: (value: T) => void;
  /** Clear all selected values */
  clear: () => void;
  /** Check if a value is selected */
  isSelected: (value: T) => boolean;
  /** Number of selected values */
  count: number;
  /** Whether any values are selected */
  hasSelection: boolean;
}

// =============================================================================
// Search Filter Types
// =============================================================================

/**
 * Result from useDeferredSearch hook.
 * Provides search state with deferred value for non-blocking UI updates.
 */
export interface DeferredSearchResult {
  /** Current search value (immediate) */
  value: string;
  /** Deferred search value (for filtering, non-blocking) */
  deferredValue: string;
  /** Set the search value */
  setValue: (value: string) => void;
  /** Clear the search value */
  clear: () => void;
  /** Whether search has a value */
  hasValue: boolean;
}

// =============================================================================
// Active Filter Types
// =============================================================================

/**
 * Represents an active filter that can be displayed and removed.
 * Used for filter chips/pills UI.
 *
 * @template TType - The filter type union (e.g., "search" | "pool" | "status")
 */
export interface ActiveFilter<TType extends string = string> {
  /** The type of filter */
  type: TType;
  /** The filter value (e.g., pool name, status value, search term) */
  value: string;
  /** Human-readable label for display in filter chips */
  label: string;
}

/**
 * Definition of a filter for building active filters list.
 *
 * @template TType - The filter type string
 */
export interface FilterDefinition<TType extends string> {
  /** The filter type identifier */
  type: TType;
  /** Function that returns current filter values */
  getValues: () => string[];
  /** Optional function to transform value to display label */
  getLabel?: (value: string) => string;
  /** Function to remove a specific value */
  remove: (value: string) => void;
  /** Function to clear all values at once */
  clear: () => void;
}

/**
 * Result from useActiveFilters hook.
 * Manages the list of active filters for display and removal.
 *
 * @template TType - The filter type union
 */
export interface ActiveFiltersResult<TType extends string> {
  /** List of all active filters */
  filters: ActiveFilter<TType>[];
  /** Remove a specific filter */
  remove: (filter: ActiveFilter<TType>) => void;
  /** Clear all filters */
  clearAll: () => void;
  /** Number of active filters */
  count: number;
  /** Whether any filters are active */
  hasFilters: boolean;
}
