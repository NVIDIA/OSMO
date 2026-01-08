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
 * Workflows Filtering Shim - Client-side filtering for workflows.
 *
 * =============================================================================
 * IDEAL BACKEND API (what we're coding toward):
 * =============================================================================
 *
 * GET /api/workflow?status=running,waiting&user=alice&pool=ml-team&offset=0&limit=50
 *
 * Response:
 * {
 *   "workflows": [...filtered workflows...],
 *   "total": 100,
 *   "filtered_total": 25,
 *   "more_entries": true
 * }
 *
 * =============================================================================
 * CURRENT SHIM (what this file does):
 * =============================================================================
 *
 * 1. Fetches workflows from backend with offset-based pagination
 * 2. Applies SmartSearch filters client-side
 * 3. Returns paginated, filtered results
 *
 * WHEN BACKEND IS UPDATED to support server-side filtering:
 * 1. Update fetchPaginatedWorkflows to pass filter params to API
 * 2. Remove client-side filtering
 * 3. No changes needed in useWorkflowsData or UI components
 */

import type { SearchChip } from "@/stores";
import { filterByChips } from "@/components/smart-search";
import type { PaginatedResponse, PaginationParams } from "@/lib/api/pagination";
import { listWorkflowApiWorkflowGet, type ListWorkflowApiWorkflowGetParams } from "@/lib/api/generated";
import type { WorkflowListEntry } from "./workflow-search-fields";
import { WORKFLOW_SEARCH_FIELDS } from "./workflow-search-fields";

// =============================================================================
// Types
// =============================================================================

export interface WorkflowFilterParams {
  /** Search chips from SmartSearch */
  searchChips: SearchChip[];
}

export interface RawWorkflowsResponse {
  workflows: WorkflowListEntry[];
  more_entries: boolean;
}

// =============================================================================
// SHIM: Client-side filtering (to be removed when backend supports filtering)
// =============================================================================

/**
 * SHIM: Apply client-side filters to workflows.
 *
 * This function handles all filtering that should ideally be done server-side.
 * When backend supports filtering, this function can be removed and filters
 * passed directly to the API.
 *
 * @internal
 */
function applyWorkflowFilters(workflows: WorkflowListEntry[], searchChips: SearchChip[]): WorkflowListEntry[] {
  if (searchChips.length === 0) return workflows;
  return filterByChips(workflows, searchChips, WORKFLOW_SEARCH_FIELDS);
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
 * Fetch paginated workflows with client-side filtering.
 *
 * Uses offset-based pagination matching the backend API.
 * When backend supports server-side filtering, this can be updated to pass
 * filter params directly to the API.
 *
 * @param params - Pagination and filter parameters
 */
export async function fetchPaginatedWorkflows(
  params: PaginationParams & WorkflowFilterParams,
): Promise<PaginatedResponse<WorkflowListEntry>> {
  const { offset = 0, limit, searchChips } = params;

  // Build API params
  const apiParams: ListWorkflowApiWorkflowGetParams = {
    offset,
    limit,
    order: "DESC", // Most recent first
  };

  // Fetch from API
  const rawData = await listWorkflowApiWorkflowGet(apiParams);
  const parsed = parseWorkflowsResponse(rawData);
  const allWorkflows = parsed?.workflows ?? [];
  const hasMore = parsed?.more_entries ?? false;

  // SHIM: Apply filters client-side
  // When backend supports filtering, remove this and pass filters to API
  const filteredWorkflows = applyWorkflowFilters(allWorkflows, searchChips);

  return {
    items: filteredWorkflows,
    hasMore,
    nextOffset: hasMore ? offset + limit : undefined,
    // Note: We don't have server-side totals, so these are approximations
    // When backend supports filtering, it will return accurate totals
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
 * Sorting ensures consistent key regardless of chip order.
 */
export function buildWorkflowsQueryKey(searchChips: SearchChip[]): readonly unknown[] {
  return [
    "workflows",
    "paginated",
    {
      chips: searchChips
        .map((c) => `${c.field}:${c.value}`)
        .sort()
        .join(","),
    },
  ] as const;
}
