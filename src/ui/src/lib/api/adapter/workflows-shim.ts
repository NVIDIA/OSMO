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

/**
 * Workflows API Adapter
 *
 * Converts UI filter state (SearchChips) to backend API parameters.
 * The backend supports full server-side filtering and pagination.
 */

import type { SearchChip } from "@/stores/types";
import type { PaginatedResponse, PaginationParams } from "@/lib/api/pagination/types";
import {
  listWorkflowApiWorkflowGet,
  type ListWorkflowApiWorkflowGetParams,
  type ListOrder,
  type WorkflowStatus,
  type WorkflowPriority,
  type SrcServiceCoreWorkflowObjectsListEntry,
} from "@/lib/api/generated";
import { parseDateRangeValue } from "@/lib/date-range-utils";

// =============================================================================
// Types
// =============================================================================

/** Re-export workflow list entry type for convenience */
export type WorkflowListEntry = SrcServiceCoreWorkflowObjectsListEntry;

export interface WorkflowFilterParams {
  /** Search chips from FilterBar */
  searchChips: SearchChip[];
  /** Show all users' workflows (default: false = current user only) */
  showAllUsers?: boolean;
  /** Sort direction */
  sortDirection?: "ASC" | "DESC";
  /** ISO date string — fallback for occupancy cross-link when no submitted chip exists */
  submittedAfter?: string;
}

export interface RawWorkflowsResponse {
  workflows: WorkflowListEntry[];
  more_entries: boolean;
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Get all chip values for a specific field.
 */
function getChipValues(chips: SearchChip[], field: string): string[] {
  return chips.filter((c) => c.field === field).map((c) => c.value);
}

/**
 * Get the first chip value for a field (for single-value filters).
 */
function getFirstChipValue(chips: SearchChip[], field: string): string | undefined {
  return chips.find((c) => c.field === field)?.value;
}

/**
 * Build API parameters from search chips and options.
 */
function buildApiParams(
  chips: SearchChip[],
  showAllUsers: boolean,
  offset: number,
  limit: number,
  sortDirection: ListOrder,
  submittedAfter?: string,
): ListWorkflowApiWorkflowGetParams {
  const poolChips = getChipValues(chips, "pool");
  const statusChips = getChipValues(chips, "status");
  const userChips = getChipValues(chips, "user");
  const priorityChips = getChipValues(chips, "priority");
  const tagChips = getChipValues(chips, "tag");

  // Resolve submitted date range: chip takes precedence over prop
  let resolvedAfter = submittedAfter;
  let resolvedBefore: string | undefined;
  const submittedChip = getFirstChipValue(chips, "submitted");
  if (submittedChip) {
    const range = parseDateRangeValue(submittedChip);
    if (range) {
      resolvedAfter = range.start.toISOString();
      resolvedBefore = range.end.toISOString();
    }
  }

  return {
    offset,
    limit,
    order: sortDirection,
    users: userChips.length > 0 ? userChips : undefined,
    statuses: statusChips.length > 0 ? (statusChips as WorkflowStatus[]) : undefined,
    pools: poolChips.length > 0 ? poolChips : undefined,
    name: getFirstChipValue(chips, "name"),
    app: getFirstChipValue(chips, "app"),
    priority: priorityChips.length > 0 ? (priorityChips as WorkflowPriority[]) : undefined,
    tags: tagChips.length > 0 ? tagChips : undefined,
    all_users: userChips.length === 0 && showAllUsers ? true : undefined,
    all_pools: poolChips.length === 0,
    submitted_after: resolvedAfter,
    submitted_before: resolvedBefore,
  };
}

// =============================================================================
// Main Exports
// =============================================================================

/**
 * Fetch paginated workflows with server-side filtering.
 *
 * Passes all filter parameters directly to the backend API.
 *
 * @param params - Pagination and filter parameters
 */
export async function fetchPaginatedWorkflows(
  params: PaginationParams & WorkflowFilterParams,
): Promise<PaginatedResponse<WorkflowListEntry>> {
  const { offset = 0, limit, searchChips, showAllUsers = false, sortDirection = "DESC", submittedAfter } = params;

  // Build API params from chips
  const apiParams = buildApiParams(
    searchChips,
    showAllUsers,
    offset,
    limit,
    sortDirection as ListOrder,
    submittedAfter,
  );

  // Fetch from API
  const response = await listWorkflowApiWorkflowGet(apiParams);
  const workflows = response.workflows;
  const hasMore = response.more_entries;

  return {
    items: workflows,
    hasMore,
    nextOffset: hasMore ? offset + limit : undefined,
    // Backend doesn't return totals, so these remain undefined
    total: undefined,
    filteredTotal: undefined,
  };
}

/**
 * Check if any filters are active.
 * Useful for UI to show "filtered" state.
 */
export function hasActiveFilters(searchChips: SearchChip[]): boolean {
  return searchChips.length > 0;
}

/**
 * Build a stable query key for React Query caching.
 * Includes all params that affect the query results.
 *
 * Unpacks filter chips into individual fields for clarity and debuggability.
 * Arrays are sorted for stability (prevents cache misses from reordering).
 */
export function buildWorkflowsQueryKey(
  searchChips: SearchChip[],
  showAllUsers: boolean = false,
  sortDirection: string = "DESC",
  submittedAfter?: string,
): readonly unknown[] {
  // Extract filter values by field
  const name = getFirstChipValue(searchChips, "name");
  const app = getFirstChipValue(searchChips, "app");
  const statuses = getChipValues(searchChips, "status").sort();
  const users = getChipValues(searchChips, "user").sort();
  const pools = getChipValues(searchChips, "pool").sort();
  const priority = getChipValues(searchChips, "priority").sort();
  const tags = getChipValues(searchChips, "tag").sort();
  const submitted = getFirstChipValue(searchChips, "submitted");

  // Build query key - only include filters that have values
  const filters: Record<string, string | string[]> = {};
  if (name) filters.name = name;
  if (app) filters.app = app;
  if (statuses.length > 0) filters.statuses = statuses;
  if (users.length > 0) filters.users = users;
  if (pools.length > 0) filters.pools = pools;
  if (priority.length > 0) filters.priority = priority;
  if (tags.length > 0) filters.tags = tags;
  if (submitted) filters.submitted = submitted;

  return [
    "workflows",
    "paginated",
    {
      ...filters,
      showAllUsers,
      sortDirection,
      ...(submittedAfter ? { submittedAfter } : {}),
    },
  ] as const;
}
