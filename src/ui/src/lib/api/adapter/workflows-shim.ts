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
  /** ISO date string — only return workflows submitted after this time */
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

  return {
    offset,
    limit,
    order: sortDirection,
    // Filters - only include if chips exist
    users: userChips.length > 0 ? userChips : undefined,
    statuses: statusChips.length > 0 ? (statusChips as WorkflowStatus[]) : undefined,
    pools: poolChips.length > 0 ? poolChips : undefined,
    name: getFirstChipValue(chips, "name"),
    app: getFirstChipValue(chips, "app"),
    priority: priorityChips.length > 0 ? (priorityChips as WorkflowPriority[]) : undefined,
    tags: tagChips.length > 0 ? tagChips : undefined,
    // Toggles
    // Only send all_users=true when no user chips exist (to show all users' workflows)
    // When user chips exist, don't send all_users (backend filters by those specific users)
    all_users: userChips.length === 0 ? showAllUsers : undefined,
    // all_pools is implicit: true when no pool filter, false when pool filter exists
    all_pools: poolChips.length === 0,
    submitted_after: submittedAfter,
  };
}

// =============================================================================
// Main Exports
// =============================================================================

/**
 * Parse the raw API response.
 *
 * The workflow API returns a JSON string that needs parsing.
 * This handles both string and already-parsed responses.
 */
export function parseWorkflowsResponse(rawData: unknown): RawWorkflowsResponse | null {
  if (!rawData) return null;
  try {
    const parsed = typeof rawData === "string" ? JSON.parse(rawData) : rawData;
    return parsed as RawWorkflowsResponse;
  } catch {
    console.error("Failed to parse workflow response");
    return null;
  }
}

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
  const parsed = parseWorkflowsResponse(response.data);
  const workflows = parsed?.workflows ?? [];

  const hasMore = parsed?.more_entries ?? false;

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

  // Build query key - only include filters that have values
  const filters: Record<string, string | string[]> = {};
  if (name) filters.name = name;
  if (app) filters.app = app;
  if (statuses.length > 0) filters.statuses = statuses;
  if (users.length > 0) filters.users = users;
  if (pools.length > 0) filters.pools = pools;
  if (priority.length > 0) filters.priority = priority;
  if (tags.length > 0) filters.tags = tags;

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
