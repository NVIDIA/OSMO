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
 * Hook to sort pools and build sharing map.
 *
 * This hook receives pre-filtered pools and:
 * - Sorts them by the current sort column
 * - Builds a sharing map for UI indicators
 *
 * Simplified from usePoolSections - no status grouping.
 */

import { useMemo } from "react";
import type { Pool } from "@/lib/api/adapter/types";
import type { SortState } from "@/components/data-table/types";
import { naturalCompare } from "@/lib/utils";

// =============================================================================
// Sorting
// =============================================================================

function sortPools(pools: Pool[], sort: SortState<string> | null, displayMode: "used" | "free"): Pool[] {
  if (!sort?.column) return pools;

  return [...pools].sort((a, b) => {
    let cmp = 0;
    switch (sort.column) {
      case "name":
        cmp = naturalCompare(a.name, b.name);
        break;
      case "status":
        cmp = naturalCompare(a.status, b.status);
        break;
      case "backend":
        cmp = naturalCompare(a.backend, b.backend);
        break;
      case "quota":
        // Sort by available (free) or used based on displayMode
        cmp = displayMode === "free" ? a.quota.free - b.quota.free : a.quota.used - b.quota.used;
        break;
      case "capacity":
        // Sort by total available (totalFree) or totalUsage based on displayMode
        cmp = displayMode === "free" ? a.quota.totalFree - b.quota.totalFree : a.quota.totalUsage - b.quota.totalUsage;
        break;
      // "platforms" and "description" are not sortable - no case needed
    }
    return sort.direction === "asc" ? cmp : -cmp;
  });
}

// =============================================================================
// Hook
// =============================================================================

interface UseSortedPoolsOptions {
  /** Pre-filtered pools from usePoolsData */
  pools: Pool[];
  /** Current sort state (from store or DataTable) */
  sort: SortState<string> | null;
  /** Sharing groups for building sharing map */
  sharingGroups: string[][];
  /** Display mode for quota/capacity sorting */
  displayMode: "used" | "free";
}

interface UseSortedPoolsResult {
  /** Sorted pools */
  sortedPools: Pool[];
  /** Map of pool names that share resources */
  sharingMap: Map<string, boolean>;
}

export function useSortedPools({
  pools,
  sort,
  sharingGroups,
  displayMode,
}: UseSortedPoolsOptions): UseSortedPoolsResult {
  // Sort pools
  const sortedPools = useMemo(() => sortPools(pools, sort, displayMode), [pools, sort, displayMode]);

  // Build map of pools that are shared (for UI indicators)
  const sharingMap = useMemo(() => {
    const map = new Map<string, boolean>();
    for (const group of sharingGroups) {
      if (group.length > 1) {
        for (const poolName of group) {
          map.set(poolName, true);
        }
      }
    }
    return map;
  }, [sharingGroups]);

  return { sortedPools, sharingMap };
}
