/**
 * SPDX-FileCopyrightText: Copyright (c) 2025 NVIDIA CORPORATION. All rights reserved.
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

"use client";

import { useCallback, useMemo } from "react";
import { useInfiniteQuery, type QueryKey } from "@tanstack/react-query";
import type {
  PaginatedResponse,
  PaginationParams,
  PaginatedDataConfig,
  PaginatedDataResult,
  PageParam,
} from "@/lib/api/pagination/types";

const DEFAULT_CONFIG: Required<PaginatedDataConfig> = {
  pageSize: 50,
  staleTime: 60_000, // 1 minute
  gcTime: 300_000, // 5 minutes
  prefetchThreshold: 10, // Fetch next page when 10 items from end
};

export interface UsePaginatedDataOptions<T, TParams extends object> {
  /**
   * Unique query key - should include all filter/sort params.
   * Changes to this key reset pagination.
   */
  queryKey: QueryKey;

  /**
   * Function to fetch a page of data.
   * Receives merged params (your params + pagination params).
   */
  queryFn: (params: TParams & PaginationParams) => Promise<PaginatedResponse<T>>;

  /**
   * Your filter/sort/etc params (excluding pagination).
   * Changes to these reset pagination automatically.
   */
  params: TParams;

  /** Pagination configuration */
  config?: Partial<PaginatedDataConfig>;

  /** Whether query is enabled (default: true) */
  enabled?: boolean;
}

/**
 * Generic paginated data hook with infinite scroll support.
 *
 * Features:
 * - Automatic page reset on filter/sort change (via queryKey)
 * - Cursor-based pagination with offset fallback
 * - Flattens pages into single items array
 * - Provides loading states for initial/next page/refetch
 *
 * @example
 * ```tsx
 * const result = usePaginatedData({
 *   queryKey: ['resources', filters, sort],
 *   queryFn: (params) => fetchResources(params),
 *   params: { pools, platforms, search, sort },
 * });
 *
 * // Use with any list/table component
 * <List
 *   items={result.items}
 *   hasNextPage={result.hasNextPage}
 *   onLoadMore={result.fetchNextPage}
 *   isFetchingNextPage={result.isFetchingNextPage}
 * />
 * ```
 */
export function usePaginatedData<T, TParams extends object>({
  queryKey,
  queryFn,
  params,
  config: userConfig,
  enabled = true,
}: UsePaginatedDataOptions<T, TParams>): PaginatedDataResult<T> {
  const config = { ...DEFAULT_CONFIG, ...userConfig };

  const query = useInfiniteQuery({
    queryKey,
    queryFn: async ({ pageParam }) => {
      // pageParam is { cursor?, offset } from getNextPageParam
      const typedPageParam = pageParam as PageParam;
      const paginationParams: PaginationParams = {
        cursor: typedPageParam?.cursor,
        offset: typedPageParam?.offset ?? 0,
        limit: config.pageSize,
      };

      return queryFn({ ...params, ...paginationParams });
    },
    initialPageParam: { cursor: undefined, offset: 0 } as PageParam,
    getNextPageParam: (lastPage, allPages): PageParam | undefined => {
      if (!lastPage.hasMore) return undefined;

      // Prefer cursor if available, fall back to offset
      if (lastPage.nextCursor) {
        return { cursor: lastPage.nextCursor, offset: 0 };
      }

      if (lastPage.nextOffset !== undefined) {
        return { cursor: undefined, offset: lastPage.nextOffset };
      }

      // Calculate offset from loaded items
      const totalLoaded = allPages.reduce((acc, page) => acc + page.items.length, 0);
      return { cursor: undefined, offset: totalLoaded };
    },
    staleTime: config.staleTime,
    gcTime: config.gcTime,
    enabled,
  });

  // Flatten all pages into single items array
  const items = useMemo(() => {
    if (!query.data?.pages) return [];
    return query.data.pages.flatMap((page) => page.items);
  }, [query.data]);

  // Get first page for metadata (counts, aggregates, etc.)
  const firstPage = query.data?.pages[0];
  const filteredCount = firstPage?.filteredTotal;
  const totalCount = firstPage?.total;

  const reset = useCallback(() => {
    // TanStack Query automatically resets when queryKey changes
    // This is for manual reset if needed
    query.refetch();
  }, [query]);

  return {
    items,
    filteredCount,
    totalCount,
    loadedCount: items.length,
    hasNextPage: query.hasNextPage ?? false,
    fetchNextPage: query.fetchNextPage,
    isFetchingNextPage: query.isFetchingNextPage,
    isLoading: query.isLoading,
    isRefetching: query.isRefetching && !query.isFetchingNextPage,
    error: query.error,
    refetch: query.refetch,
    reset,
    firstPage,
  };
}

/**
 * Default configuration for paginated data.
 * Exported for testing and customization.
 */
export { DEFAULT_CONFIG as PAGINATED_DATA_DEFAULTS };
