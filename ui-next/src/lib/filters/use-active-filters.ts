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

"use client";

import { useCallback, useMemo } from "react";
import type { ActiveFilter, FilterDefinition, ActiveFiltersResult } from "./types";

/**
 * Hook for managing active filter display and removal.
 *
 * Takes a list of filter definitions and builds a unified active filters
 * list that can be displayed as chips/pills. Provides remove and clear
 * functionality that delegates to the appropriate filter handlers.
 *
 * @template TType - The filter type union string
 * @param definitions - Array of filter definitions
 * @returns Active filters state and handlers
 *
 * @example
 * ```tsx
 * const poolFilter = useSetFilter<string>();
 * const platformFilter = useSetFilter<string>();
 * const search = useDeferredSearch();
 *
 * const activeFilters = useActiveFilters<"pool" | "platform" | "search">([
 *   {
 *     type: "search",
 *     getValues: () => search.value ? [search.value] : [],
 *     getLabel: (v) => `"${v}"`,
 *     remove: () => search.clear(),
 *   },
 *   {
 *     type: "pool",
 *     getValues: () => Array.from(poolFilter.selected),
 *     remove: (v) => poolFilter.toggle(v),
 *   },
 *   {
 *     type: "platform",
 *     getValues: () => Array.from(platformFilter.selected),
 *     remove: (v) => platformFilter.toggle(v),
 *   },
 * ]);
 *
 * // Render chips
 * {activeFilters.filters.map(f => (
 *   <Chip key={`${f.type}-${f.value}`} onRemove={() => activeFilters.remove(f)}>
 *     {f.label}
 *   </Chip>
 * ))}
 * ```
 */
export function useActiveFilters<TType extends string>(
  definitions: FilterDefinition<TType>[],
): ActiveFiltersResult<TType> {
  // Build the active filters list from definitions
  const filters = useMemo(() => {
    const result: ActiveFilter<TType>[] = [];

    for (const def of definitions) {
      const values = def.getValues();
      for (const value of values) {
        result.push({
          type: def.type,
          value,
          label: def.getLabel ? def.getLabel(value) : value,
        });
      }
    }

    return result;
  }, [definitions]);

  // Remove a specific filter by finding its definition and calling remove
  const remove = useCallback(
    (filter: ActiveFilter<TType>) => {
      const def = definitions.find((d) => d.type === filter.type);
      if (def) {
        def.remove(filter.value);
      }
    },
    [definitions],
  );

  // Clear all filters
  const clearAll = useCallback(() => {
    for (const def of definitions) {
      def.clear();
    }
  }, [definitions]);

  return {
    filters,
    remove,
    clearAll,
    count: filters.length,
    hasFilters: filters.length > 0,
  };
}
