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
 * Server-Side Dataset Fetching
 *
 * Prefetch datasets data on the server for SSR/RSC hydration.
 * Uses React's cache() for request deduplication and prefetchInfiniteQuery
 * to match the client's usePaginatedData hook.
 */

import { cache } from "react";
import { QueryClient } from "@tanstack/react-query";
import type { SearchChip } from "@/stores/types";
import { buildDatasetsQueryKey, buildDatasetDetailQueryKey } from "@/lib/api/adapter/datasets";
import { DEFAULT_PAGE_SIZE } from "@/lib/config";

// =============================================================================
// Prefetch Functions
// =============================================================================

/**
 * Prefetch the first page of datasets for infinite query hydration.
 *
 * Uses prefetchInfiniteQuery to match the client's usePaginatedData hook.
 * Only prefetches the first page — subsequent pages are fetched on demand.
 *
 * @param queryClient - The QueryClient to prefetch into
 * @param filterChips - Filter chips from URL (including default user chip if pre-populated)
 * @param showAllUsers - Whether to include all users' datasets (default: false)
 * @param sortDirection - Sort order (default: DESC — newest first)
 */
export const prefetchDatasetsList = cache(
  async (
    queryClient: QueryClient,
    filterChips: SearchChip[] = [],
    showAllUsers = false,
    sortDirection: "ASC" | "DESC" = "DESC",
  ) => {
    const { fetchPaginatedDatasets } = await import("@/lib/api/adapter/datasets");

    const queryKey = buildDatasetsQueryKey(filterChips, showAllUsers, sortDirection);

    await queryClient.prefetchInfiniteQuery({
      queryKey,
      queryFn: async () => {
        return fetchPaginatedDatasets({
          offset: 0,
          limit: DEFAULT_PAGE_SIZE,
          searchChips: filterChips,
          showAllUsers,
          sortDirection,
        });
      },
      initialPageParam: { cursor: undefined, offset: 0 },
    });
  },
);

/**
 * Prefetch a single dataset detail by name for hydration.
 *
 * @param queryClient - The QueryClient to prefetch into
 * @param bucket - Bucket name
 * @param name - Dataset name
 */
export const prefetchDatasetDetail = cache(async (queryClient: QueryClient, bucket: string, name: string) => {
  const { fetchDatasetDetail } = await import("@/lib/api/adapter/datasets");

  const queryKey = buildDatasetDetailQueryKey(bucket, name);

  await queryClient.prefetchQuery({
    queryKey,
    queryFn: () => fetchDatasetDetail(bucket, name),
  });
});
