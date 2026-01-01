/**
 * Copyright (c) 2025, NVIDIA CORPORATION. All rights reserved.
 *
 * NVIDIA CORPORATION and its licensors retain all intellectual property
 * and proprietary rights in and to this software, related documentation
 * and any modifications thereto. Any use, reproduction, disclosure or
 * distribution of this software and related documentation without an express
 * license agreement from NVIDIA CORPORATION is strictly prohibited.
 */

import { useMemo } from "react";
import type { Pool } from "@/lib/api/adapter";
import type { SortState } from "@/lib/table";
import { filterByChips, type SearchChip } from "@/components/ui/smart-search";
import { createPoolSearchFields } from "../lib/pool-search-fields";
import { STATUS_ORDER, getStatusDisplay } from "../lib/constants";
import type { PoolColumnId } from "../lib/pool-columns";

export interface StatusSection {
  status: string;
  label: string;
  pools: Pool[];
}

function sortPools(pools: Pool[], sort: SortState<PoolColumnId>, displayMode: "used" | "free"): Pool[] {
  if (!sort.column) return pools;

  return [...pools].sort((a, b) => {
    let cmp = 0;
    switch (sort.column) {
      case "name":
        cmp = a.name.localeCompare(b.name);
        break;
      case "backend":
        cmp = a.backend.localeCompare(b.backend);
        break;
      case "quota":
        // Sort by available (free) or used based on displayMode
        cmp = displayMode === "free"
          ? a.quota.free - b.quota.free
          : a.quota.used - b.quota.used;
        break;
      case "capacity":
        // Sort by total available (totalFree) or totalUsage based on displayMode
        cmp = displayMode === "free"
          ? a.quota.totalFree - b.quota.totalFree
          : a.quota.totalUsage - b.quota.totalUsage;
        break;
      // "platforms" and "description" are not sortable - no case needed
    }
    return sort.direction === "asc" ? cmp : -cmp;
  });
}

interface UsePoolSectionsOptions {
  pools: Pool[];
  searchChips: SearchChip[];
  sort: SortState<PoolColumnId>;
  sharingGroups: string[][];
  displayMode: "used" | "free";
}

export function usePoolSections({ pools, searchChips, sort, sharingGroups, displayMode }: UsePoolSectionsOptions) {
  // Create search fields with sharing context
  const searchFields = useMemo(
    () => createPoolSearchFields(sharingGroups),
    [sharingGroups],
  );

  const filteredPools = useMemo(() => {
    if (searchChips.length === 0) return pools;
    return filterByChips(pools, searchChips, searchFields);
  }, [pools, searchChips, searchFields]);

  const sections: StatusSection[] = useMemo(() => {
    const grouped = new Map<string, Pool[]>();
    for (const pool of filteredPools) {
      if (!grouped.has(pool.status)) grouped.set(pool.status, []);
      grouped.get(pool.status)!.push(pool);
    }

    return STATUS_ORDER.map((status) => {
      const display = getStatusDisplay(status);
      return {
        status: display.category,
        label: display.label,
        pools: sortPools(grouped.get(status) ?? [], sort, displayMode),
      };
    }).filter((s) => s.pools.length > 0);
  }, [filteredPools, sort, displayMode]);

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

  return { sections, filteredPools, sharingMap };
}
