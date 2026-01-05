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

/**
 * Generic pagination types used across the codebase.
 * Provides a consistent interface for paginated data regardless of backend implementation.
 */

/**
 * Generic paginated response from any API.
 * Adapter layer transforms backend responses to this shape.
 */
export interface PaginatedResponse<T> {
  /** Items in this page */
  items: T[];
  /** Opaque cursor for next page (cursor-based pagination) */
  nextCursor?: string | null;
  /** Next offset for fallback (offset-based pagination) */
  nextOffset?: number;
  /** Whether more data is available */
  hasMore: boolean;
  /** Count matching current filters (the "X" in "X of Y") */
  filteredTotal?: number;
  /** Total count before filters (the "Y" in "X of Y") */
  total?: number;
}

/**
 * Parameters for paginated queries.
 */
export interface PaginationParams {
  /** Cursor from previous page (takes precedence over offset) */
  cursor?: string;
  /** Offset for offset-based fallback */
  offset?: number;
  /** Number of items per page */
  limit: number;
}

/**
 * Configuration for paginated data hook.
 */
export interface PaginatedDataConfig {
  /** Default page size */
  pageSize: number;
  /** Stale time in ms (default: 60000) */
  staleTime?: number;
  /** GC time in ms (default: 300000) */
  gcTime?: number;
  /** Prefetch threshold - how many items before end to trigger fetch */
  prefetchThreshold?: number;
}

/**
 * Return type from usePaginatedData hook.
 */
export interface PaginatedDataResult<T> {
  /** Flattened items from all loaded pages */
  items: T[];
  /** Count matching current filters (the "X" in "X of Y") */
  filteredCount?: number;
  /** Total count before filters (the "Y" in "X of Y") */
  totalCount?: number;
  /** Number of items currently loaded */
  loadedCount: number;
  /** Whether more pages are available */
  hasNextPage: boolean;
  /** Function to load next page */
  fetchNextPage: () => void;
  /** Loading state for next page fetch */
  isFetchingNextPage: boolean;
  /** Initial loading state */
  isLoading: boolean;
  /** Background refresh state */
  isRefetching: boolean;
  /** Error from last request */
  error: Error | null;
  /** Manual refetch all pages */
  refetch: () => void;
  /** Reset to first page */
  reset: () => void;
}

/**
 * Page parameter used by useInfiniteQuery.
 * Supports both cursor and offset pagination.
 */
export interface PageParam {
  cursor?: string;
  offset: number;
}
