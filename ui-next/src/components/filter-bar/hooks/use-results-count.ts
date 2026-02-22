/**
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION. All rights reserved.
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
 * Results Count Hook
 *
 * Memoized hook for computing results count for FilterBar display.
 * Consolidates the duplicated useMemo pattern across page components.
 *
 * @example
 * ```tsx
 * // Before: 7 lines of boilerplate
 * const resultsCount = useMemo<ResultsCount>(
 *   () => ({
 *     total,
 *     filtered: hasActiveFilters ? filteredTotal : undefined,
 *   }),
 *   [total, filteredTotal, hasActiveFilters],
 * );
 *
 * // After: 1 line
 * const resultsCount = useResultsCount({ total, filteredTotal, hasActiveFilters });
 * ```
 */

import { useMemo } from "react";
import type { ResultsCount } from "@/components/filter-bar/lib/types";

// =============================================================================
// Types
// =============================================================================

export interface UseResultsCountOptions {
  /** Total number of items before filtering */
  total: number;
  /** Number of items after filtering (optional) */
  filteredTotal?: number;
  /** Whether any filters are currently active */
  hasActiveFilters: boolean;
}

// =============================================================================
// Hook
// =============================================================================

/**
 * Compute memoized results count for FilterBar display.
 *
 * Returns a ResultsCount object that shows:
 * - Total count always
 * - Filtered count only when filters are active
 *
 * @param options - Total, filtered total, and filter state
 * @returns Memoized ResultsCount object
 */
export function useResultsCount({ total, filteredTotal, hasActiveFilters }: UseResultsCountOptions): ResultsCount {
  return useMemo(
    () => ({
      total,
      filtered: hasActiveFilters ? filteredTotal : undefined,
    }),
    [total, filteredTotal, hasActiveFilters],
  );
}
