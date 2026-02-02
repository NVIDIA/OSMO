//SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION. All rights reserved.

//Licensed under the Apache License, Version 2.0 (the "License");
//you may not use this file except in compliance with the License.
//You may obtain a copy of the License at

//http://www.apache.org/licenses/LICENSE-2.0

//Unless required by applicable law or agreed to in writing, software
//distributed under the License is distributed on an "AS IS" BASIS,
//WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//See the License for the specific language governing permissions and
//limitations under the License.

//SPDX-License-Identifier: Apache-2.0

/**
 * Filter Chips URL State Management
 *
 * Manages log viewer filter chips via URL query parameters.
 * This enables shareable/bookmarkable filtered log views.
 *
 * ## URL Parameter Format
 *
 * Filter chips are stored as repeated `f` parameters:
 * - `?f=level:error&f=task:train` → two chips
 *
 * @example
 * ```tsx
 * const { filterChips, setFilterChips } = useFilterChipsUrlState();
 *
 * // Add a filter
 * setFilterChips([...filterChips, { field: 'level', value: 'error' }]);
 *
 * // Clear all filters
 * setFilterChips([]);
 * ```
 */

"use client";

import { useMemo, useCallback } from "react";
import { useQueryState, parseAsArrayOf, parseAsString } from "nuqs";
import type { SearchChip } from "@/components/filter-bar";
import { parseUrlChips } from "@/lib/url-utils";

// =============================================================================
// Types
// =============================================================================

export interface UseFilterChipsUrlStateReturn {
  /** Filter chips (level, task, retry, source) */
  filterChips: SearchChip[];
  /** Set filter chips (replaces all existing) */
  setFilterChips: (chips: SearchChip[]) => void;
}

// =============================================================================
// Hook
// =============================================================================

/**
 * URL-synced state for log viewer filter chips.
 *
 * Syncs SearchChip[] with ?f=level:error&f=task:train query parameters.
 * Changes are persisted immediately to URL.
 */
export function useFilterChipsUrlState(): UseFilterChipsUrlStateReturn {
  const [filterStrings, setFilterStrings] = useQueryState(
    "f",
    parseAsArrayOf(parseAsString).withOptions({
      shallow: true,
      history: "replace",
      clearOnDefault: true,
    }),
  );

  // Parse filter strings to SearchChip format
  const filterChips = useMemo<SearchChip[]>(() => parseUrlChips(filterStrings ?? []), [filterStrings]);

  // Convert chips back to filter strings for URL
  const setFilterChips = useCallback(
    (chips: SearchChip[]) => {
      if (chips.length === 0) {
        setFilterStrings(null);
      } else {
        setFilterStrings(chips.map((c) => `${c.field}:${c.value}`));
      }
    },
    [setFilterStrings],
  );

  return {
    filterChips,
    setFilterChips,
  };
}
