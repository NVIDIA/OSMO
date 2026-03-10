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
 * Data hook for the occupancy page.
 *
 * Converts FilterBar chips → API params, calls the occupancy shim,
 * and returns aggregated groups + computed totals for KPI cards.
 *
 * SHIM NOTE: The shim fetches ALL summary rows and aggregates client-side.
 * When backend ships group_by pagination (Issue #23), update fetchOccupancySummary
 * in occupancy-shim.ts — this hook and the UI require zero changes.
 */

"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { WorkflowPriority } from "@/lib/api/generated";
import type { OccupancyGroup, OccupancyGroupBy, OccupancySortBy, OccupancyTotals } from "@/lib/api/adapter/occupancy";
import { fetchOccupancySummary, aggregateGroups, sortGroupsLocal } from "@/lib/api/adapter/occupancy-shim";
import type { SearchChip } from "@/stores/types";

// =============================================================================
// Types
// =============================================================================

interface UseOccupancyDataParams {
  groupBy: OccupancyGroupBy;
  sortBy: OccupancySortBy;
  order: "asc" | "desc";
  searchChips: SearchChip[];
}

interface UseOccupancyDataReturn {
  groups: OccupancyGroup[];
  totals: OccupancyTotals;
  isLoading: boolean;
  error: Error | null;
  refetch: () => void;
  truncated: boolean;
}

// =============================================================================
// Hook
// =============================================================================

export function useOccupancyData({
  groupBy,
  sortBy,
  order,
  searchChips,
}: UseOccupancyDataParams): UseOccupancyDataReturn {
  // Single-pass extraction of filter params from chips
  const queryParams = useMemo(() => {
    const users: string[] = [];
    const pools: string[] = [];
    const priorities: WorkflowPriority[] = [];
    for (const chip of searchChips) {
      if (chip.field === "user") users.push(chip.value);
      else if (chip.field === "pool") pools.push(chip.value);
      else if (chip.field === "priority") priorities.push(chip.value as WorkflowPriority);
    }
    return { users, pools, priorities };
    // Intentionally excludes groupBy/sortBy/order — switching group view or
    // resorting never triggers a network re-fetch. The shim returns raw rows;
    // aggregation + sort happen below.
  }, [searchChips]);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["occupancy", queryParams],
    queryFn: () => fetchOccupancySummary(queryParams),
    staleTime: 30_000,
  });

  // Aggregate by groupBy — does not depend on sort, so totals stay stable on resort
  const aggregated = useMemo<OccupancyGroup[]>(
    () => (data?.summaries ? aggregateGroups(data.summaries, groupBy) : []),
    [data, groupBy],
  );

  // Sort client-side — no network request on sort change
  const groups = useMemo<OccupancyGroup[]>(
    () => sortGroupsLocal(aggregated, sortBy, order),
    [aggregated, sortBy, order],
  );

  // Compute KPI totals from aggregated (pre-sort) groups — stable across resort
  const totals = useMemo<OccupancyTotals>(() => {
    const acc: OccupancyTotals = { gpu: 0, cpu: 0, memory: 0, storage: 0, high: 0, normal: 0, low: 0 };
    for (const g of aggregated) {
      acc.gpu += g.gpu;
      acc.cpu += g.cpu;
      acc.memory += g.memory;
      acc.storage += g.storage;
      acc.high += g.high;
      acc.normal += g.normal;
      acc.low += g.low;
    }
    return acc;
  }, [aggregated]);

  return {
    groups,
    totals,
    isLoading,
    error: error as Error | null,
    refetch,
    truncated: data?.truncated ?? false,
  };
}
