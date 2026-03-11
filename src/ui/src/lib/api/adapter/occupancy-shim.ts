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
 * Occupancy Shim — Fetch-all + client-side aggregate stopgap.
 *
 * =============================================================================
 * WHY THIS SHIM EXISTS
 * =============================================================================
 *
 * The backend returns raw (user, pool, priority) rows from GET /api/task?summary=true.
 * To render the BY USER view, we need one aggregated row per user — but with
 * infinite scroll, page N of raw rows will contain partial user records split
 * across pages. So we fetch ALL rows and aggregate in JS.
 *
 * SCALE CEILING: This approach is NOT production-ready at large scale.
 * See BACKEND_TODOS.md Issue #23 for the required backend group_by pagination.
 *
 * MIGRATION PATH (when backend ships Issue #23):
 * 1. Update fetchOccupancySummary to call the new endpoint with group_by param
 * 2. Remove aggregateGroups / sortGroupsLocal / the MAX_SUMMARY_ROWS guard
 * 3. Hook and component layer require ZERO changes — same return shape
 *
 * =============================================================================
 */

import {
  listTaskApiTaskGet,
  type ListTaskSummaryResponse,
  WorkflowPriority,
  TaskGroupStatus,
} from "@/lib/api/generated";
import type { OccupancyGroup, OccupancyChild, OccupancyGroupBy, OccupancySortBy } from "@/lib/api/adapter/occupancy";

// =============================================================================
// Scale guard
// =============================================================================

const MAX_SUMMARY_ROWS = 10_000;

// =============================================================================
// Params & Result
// =============================================================================

/** Fetch params — groupBy/sortBy/order intentionally excluded so they don't bust the cache */
export interface OccupancyQueryParams {
  users?: string[];
  pools?: string[];
  priorities?: WorkflowPriority[];
  statuses?: TaskGroupStatus[];
}

export interface OccupancySummaryResult {
  /** Raw (user, pool, priority) rows — not yet grouped or sorted */
  summaries: ListTaskSummaryResponse["summaries"];
  /** True when the backend returned ≥ MAX_SUMMARY_ROWS — results may be incomplete */
  truncated: boolean;
}

// =============================================================================
// Aggregation helpers
// =============================================================================

function incrementPriority(target: { high: number; normal: number; low: number }, priority: string): void {
  if (priority === WorkflowPriority.HIGH) target.high++;
  else if (priority === WorkflowPriority.NORMAL) target.normal++;
  else if (priority === WorkflowPriority.LOW) target.low++;
}

export function aggregateGroups(
  summaries: ListTaskSummaryResponse["summaries"],
  groupBy: OccupancyGroupBy,
): OccupancyGroup[] {
  const groupMap = new Map<string, { group: OccupancyGroup; childMap: Map<string, OccupancyChild> }>();

  for (const entry of summaries) {
    const groupKey = groupBy === "user" ? entry.user : (entry.pool ?? "unknown");
    const childKey = groupBy === "user" ? (entry.pool ?? "unknown") : entry.user;

    let bucket = groupMap.get(groupKey);
    if (!bucket) {
      bucket = {
        group: { key: groupKey, gpu: 0, cpu: 0, memory: 0, storage: 0, high: 0, normal: 0, low: 0, children: [] },
        childMap: new Map(),
      };
      groupMap.set(groupKey, bucket);
    }

    const { group } = bucket;
    group.gpu += entry.gpu;
    group.cpu += entry.cpu;
    group.memory += entry.memory;
    group.storage += entry.storage;
    incrementPriority(group, entry.priority);

    let child = bucket.childMap.get(childKey);
    if (!child) {
      child = { key: childKey, gpu: 0, cpu: 0, memory: 0, storage: 0, high: 0, normal: 0, low: 0 };
      bucket.childMap.set(childKey, child);
      group.children.push(child);
    }
    child.gpu += entry.gpu;
    child.cpu += entry.cpu;
    child.memory += entry.memory;
    child.storage += entry.storage;
    incrementPriority(child, entry.priority);
  }

  return Array.from(groupMap.values()).map((b) => b.group);
}

function compareByField<T extends { key: string }>(a: T, b: T, sortBy: OccupancySortBy, dir: 1 | -1): number {
  if (sortBy === "key") return dir * a.key.localeCompare(b.key);
  return dir * ((a as unknown as Record<string, number>)[sortBy] - (b as unknown as Record<string, number>)[sortBy]);
}

export function sortGroupsLocal(
  groups: OccupancyGroup[],
  sortBy: OccupancySortBy,
  order: "asc" | "desc",
): OccupancyGroup[] {
  const dir = order === "asc" ? 1 : -1;
  return [...groups]
    .sort((a, b) => compareByField(a, b, sortBy, dir))
    .map((group) => ({
      ...group,
      children: [...group.children].sort((a, b) => compareByField(a, b, sortBy, dir)),
    }));
}

// =============================================================================
// Main shim function
// =============================================================================

export async function fetchOccupancySummary(params: OccupancyQueryParams): Promise<OccupancySummaryResult> {
  const hasPoolFilter = params.pools != null && params.pools.length > 0;
  const hasUserFilter = params.users != null && params.users.length > 0;

  const response = await listTaskApiTaskGet({
    summary: true,
    limit: MAX_SUMMARY_ROWS,
    ...(hasUserFilter ? { users: params.users } : {}),
    ...(hasPoolFilter ? { pools: params.pools } : {}),
    ...(params.priorities && params.priorities.length > 0 ? { priority: params.priorities } : {}),
    ...(params.statuses && params.statuses.length > 0 ? { statuses: params.statuses } : {}),
    all_pools: !hasPoolFilter,
    all_users: !hasUserFilter,
  });

  // customFetch throws on 4xx/5xx — we only reach here on 200
  const responseData = response.data as unknown as ListTaskSummaryResponse;
  const summaries = responseData?.summaries ?? [];
  const truncated = summaries.length >= MAX_SUMMARY_ROWS;

  if (truncated) {
    console.warn(
      `[occupancy-shim] Received ${summaries.length} summary rows — at or near fetch limit. ` +
        `Results may be incomplete. Backend group_by pagination (Issue #23) required for production scale.`,
    );
  }

  return { summaries, truncated };
}
