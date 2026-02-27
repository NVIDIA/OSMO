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
 * Datasets Filtering Shim - Client-side filtering for datasets.
 *
 * =============================================================================
 * IDEAL BACKEND API (what we're coding toward):
 * =============================================================================
 *
 * GET /api/bucket/list_dataset?name=foo&buckets=ml-data&user=alice
 *   &created_after=2024-01-01&created_before=2024-12-31
 *   &updated_after=2024-01-01&updated_before=2024-12-31
 *   &sort_by=name&sort_dir=asc
 *
 * =============================================================================
 * CURRENT SHIM (what this file does):
 * =============================================================================
 *
 * 1. Fetches ALL datasets from backend (count: 10_000)
 *    - name, bucket, user, all_users handled server-side
 * 2. Applies date range filters client-side (created_at, updated_at)
 *    - Backend does not yet support date filtering
 * 3. Sort accepted as parameter — wired in Phase 4
 *
 * WHEN BACKEND IS UPDATED:
 * 1. Delete this file entirely
 * 2. Update useAllDatasets to include date/sort params in query key
 * 3. No changes needed in use-datasets-data or UI components
 */

import type { Dataset } from "@/lib/api/adapter/datasets";
import type { SearchChip, SortDirection } from "@/stores/types";
import { parseDateRangeValue } from "@/lib/date-range-utils";
import { naturalCompare } from "@/lib/utils";
import { DatasetType } from "@/lib/api/generated";

// =============================================================================
// Main Export
// =============================================================================

/**
 * SHIM: Apply client-side filters to cached dataset data.
 *
 * Only applies filters that the backend does not yet support:
 * - created_at date range filtering
 * - updated_at date range filtering
 *
 * Server-side filters (name, bucket, user, all_users) are already applied
 * by the backend and are not re-applied here.
 *
 * @param allDatasets - All datasets from React Query cache
 * @param searchChips - Active filter chips from FilterBar
 * @param _sort - Sort state (used in Phase 4; accepted here to avoid signature change)
 */
export function applyDatasetsFiltersSync(
  allDatasets: Dataset[],
  searchChips: SearchChip[],
  sort: { column: string; direction: SortDirection } | null,
): { datasets: Dataset[]; total: number; filteredTotal: number } {
  let result = allDatasets;

  // SHIM: Filter by type (DATASET or COLLECTION)
  const typeChips = searchChips.filter((c) => c.field === "type");
  for (const chip of typeChips) {
    if (chip.value === DatasetType.COLLECTION) {
      result = result.filter((d) => d.type === DatasetType.COLLECTION);
    } else if (chip.value === DatasetType.DATASET) {
      result = result.filter((d) => d.type === DatasetType.DATASET);
    }
  }

  // SHIM: Filter by created_at date range (server doesn't support this yet)
  const createdAtChips = searchChips.filter((c) => c.field === "created_at");
  for (const chip of createdAtChips) {
    const range = parseDateRangeValue(chip.value);
    if (range) {
      result = result.filter((d) => {
        const t = new Date(d.created_at).getTime();
        return t >= range.start.getTime() && t <= range.end.getTime();
      });
    }
  }

  // SHIM: Filter by updated_at date range (server doesn't support this yet)
  const updatedAtChips = searchChips.filter((c) => c.field === "updated_at");
  for (const chip of updatedAtChips) {
    const range = parseDateRangeValue(chip.value);
    if (range) {
      result = result.filter((d) => {
        const t = new Date(d.updated_at).getTime();
        return t >= range.start.getTime() && t <= range.end.getTime();
      });
    }
  }

  // Client-side sort (server doesn't support sorting yet)
  if (sort) {
    const dir = sort.direction === "asc" ? 1 : -1;
    result = [...result].sort((a, b) => {
      switch (sort.column) {
        case "name":
          return naturalCompare(a.name, b.name) * dir;
        case "bucket":
          return naturalCompare(a.bucket, b.bucket) * dir;
        case "version":
          return ((a.version ?? 0) - (b.version ?? 0)) * dir;
        case "size_bytes":
          return (a.size_bytes - b.size_bytes) * dir;
        case "created_at":
          return (new Date(a.created_at).getTime() - new Date(b.created_at).getTime()) * dir;
        case "updated_at":
          return (new Date(a.updated_at).getTime() - new Date(b.updated_at).getTime()) * dir;
        case "type":
          return naturalCompare(a.type, b.type) * dir;
        default:
          return 0;
      }
    });
  }

  return {
    datasets: result,
    total: allDatasets.length,
    filteredTotal: result.length,
  };
}

/**
 * Check if any client-side filters are active.
 * Useful for UI to show "filtered" state.
 */
export function hasActiveDatasetFilters(searchChips: SearchChip[]): boolean {
  return searchChips.length > 0;
}
