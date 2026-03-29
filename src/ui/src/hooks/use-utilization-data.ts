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

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { listTaskApiTaskGet, type ListTaskEntry, type ListTaskResponse } from "@/lib/api/generated";
import { QUERY_STALE_TIME } from "@/lib/config";
import {
  type FetchTier,
  type UtilizationResult,
  TIER_MS,
  selectTier,
  autoGranularityMs,
  bucketTasks,
  UTILIZATION_QUERY_KEY,
  MAX_TASK_ROWS,
  floorToHour,
  ceilToHour,
} from "@/lib/api/adapter/utilization";

const PAGE_LIMIT = 1_000;

async function fetchAllTasks(
  tierStartISO: string,
  tierEndISO: string,
): Promise<{ tasks: ListTaskEntry[]; truncated: boolean }> {
  const allTasks: ListTaskEntry[] = [];
  let offset = 0;
  let truncated = false;

  while (allTasks.length < MAX_TASK_ROWS) {
    const response = await listTaskApiTaskGet({
      started_before: tierEndISO,
      ended_after: tierStartISO,
      all_users: true,
      all_pools: true,
      limit: PAGE_LIMIT,
      offset,
    });

    const responseData = response.data as unknown as ListTaskResponse;
    const tasks = responseData?.tasks ?? [];
    allTasks.push(...tasks);

    if (tasks.length < PAGE_LIMIT) break;

    offset += PAGE_LIMIT;

    if (allTasks.length >= MAX_TASK_ROWS) {
      truncated = true;
      break;
    }
  }

  return { tasks: allTasks.slice(0, MAX_TASK_ROWS), truncated };
}

interface UseUtilizationDataParams {
  displayStartMs: number;
  displayEndMs: number;
}

export function useUtilizationData({ displayStartMs, displayEndMs }: UseUtilizationDataParams): UtilizationResult & {
  isLoading: boolean;
  granularityMs: number;
  error: Error | null;
  refetch: () => void;
} {
  const rangeMs = displayEndMs - displayStartMs;
  const tier: FetchTier = selectTier(rangeMs);
  const tierMs = TIER_MS[tier];

  const tierStartMs = floorToHour(displayEndMs - tierMs);
  const tierEndMs = ceilToHour(displayEndMs);
  const tierStartISO = new Date(tierStartMs).toISOString();
  const tierEndISO = new Date(tierEndMs).toISOString();

  const queryKey = UTILIZATION_QUERY_KEY(tierStartISO, tier);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey,
    queryFn: () => fetchAllTasks(tierStartISO, tierEndISO),
    staleTime: QUERY_STALE_TIME.STANDARD,
  });

  const granularityMs = autoGranularityMs(rangeMs);

  const tasks = data?.tasks;
  const buckets = useMemo(() => {
    if (!tasks?.length) return [];
    return bucketTasks(tasks, displayStartMs, displayEndMs, granularityMs);
  }, [tasks, displayStartMs, displayEndMs, granularityMs]);

  return {
    buckets,
    truncated: data?.truncated ?? false,
    isLoading,
    error,
    refetch,
    granularityMs,
  };
}
