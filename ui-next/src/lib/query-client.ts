/**
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION. All rights reserved.
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

import { QueryClient } from "@tanstack/react-query";
import { isApiError } from "@/lib/api/fetcher";
import { QUERY_STALE_TIME_MS, QUERY_MAX_RETRY_DELAY_MS } from "@/lib/config";

/**
 * Creates an optimized QueryClient with shared configuration for both
 * Server and Client components.
 *
 * Features:
 * - Short caching for real-time data accuracy
 * - Background refetching disabled to prevent redundant production calls
 * - Structural sharing for minimal re-renders
 * - Smart retry with exponential backoff
 *
 * ## Structural Sharing
 *
 * structuralSharing is a key performance optimization that prevents unnecessary
 * re-renders when API responses are semantically identical but have new object references.
 *
 * How it works:
 * 1. After queryFn runs, TanStack Query performs deep equality check
 * 2. If new data === old data (by value, not reference), old reference is kept
 * 3. Components using the query don't re-render (same reference = no change)
 *
 * This is enabled globally (structuralSharing: true) and works automatically with
 * the `select` option for data transformation:
 *
 * @example
 * ```typescript
 * useQuery({
 *   queryKey: ['workflow', name],
 *   queryFn: () => fetchWorkflow(name),
 *   select: (raw) => transformWorkflow(raw), // structuralSharing applied to result
 * });
 * ```
 *
 * Benefits:
 * - ✅ Prevents infinite re-render loops when backend returns identical data
 * - ✅ Automatic reference stabilization without manual intervention
 * - ✅ Works at two levels: queryFn result AND select result
 * - ✅ Optimized C-level implementation (faster than custom JS deep equality)
 *
 * @see {@link https://tanstack.com/query/latest/docs/react/guides/render-optimizations#structural-sharing}
 * @see {@link ../../../docs/STABILIZATION_ANALYSIS.md} - Analysis of custom vs built-in stabilization
 */
export function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Data freshness - use config value (default 2 min for better slow network handling)
        staleTime: QUERY_STALE_TIME_MS,
        // Keep unused data in cache for 5 minutes
        gcTime: 5 * 60 * 1000,
        // PERFORMANCE: Set to false to prevent aggressive background refetching
        // that can cause redundant production API calls and re-renders.
        refetchOnWindowFocus: false,
        // PERFORMANCE: Refetch only if data is stale - respects staleTime while
        // still refreshing when data is actually stale (past staleTime).
        // This prevents both aggressive refetching (false) and stale data issues (true).
        refetchOnMount: (query) => {
          // Custom function: only refetch if data is stale
          const queryStaleTime = (query.options as { staleTime?: number }).staleTime ?? QUERY_STALE_TIME_MS;
          return query.state.dataUpdatedAt === 0 || Date.now() - query.state.dataUpdatedAt > queryStaleTime;
        },
        // Refetch when network reconnects
        refetchOnReconnect: true,
        // PERFORMANCE OPTIMIZATION: Structural sharing prevents re-renders from identical data
        //
        // Enabled globally to provide automatic reference stabilization for all queries.
        // This performs deep equality checks on query results and preserves references
        // when data is semantically identical, preventing unnecessary component re-renders.
        //
        // Works in conjunction with the `select` option:
        // - Level 1: Compares queryFn results (raw API responses)
        // - Level 2: Compares select results (transformed data)
        structuralSharing: true,
        // Network mode - online first for real-time accuracy
        networkMode: "online",
        // Enhanced retry logic with circuit breaker pattern
        // Circuit breaker prevents cascading failures by stopping retries after max attempts
        retry: (failureCount, error) => {
          // Circuit breaker: stop after 3 attempts to prevent thundering herd
          // This protects both client and server from request storms during outages
          if (failureCount >= 3) return false;

          // Check if error is an ApiError with retryable flag
          if (isApiError(error)) {
            const status = (error as { status?: number })?.status;
            // Don't retry client errors (4xx) except timeout (408)
            if (status && status >= 400 && status < 500 && status !== 408) {
              return false;
            }
            // Retry server errors (5xx) and timeouts
            return error.isRetryable;
          }

          // Retry network errors (fetch failures)
          if (error instanceof TypeError && error.message.includes("fetch")) {
            return true;
          }

          // For other errors, don't retry (fail fast)
          return false;
        },
        // Exponential backoff with jitter: 1s, 2s, 4s, capped at QUERY_MAX_RETRY_DELAY_MS
        // Jitter prevents thundering herd when multiple requests fail simultaneously
        retryDelay: (attemptIndex) => {
          const baseDelay = Math.min(1000 * 2 ** attemptIndex, QUERY_MAX_RETRY_DELAY_MS);
          // Add ±20% jitter to prevent synchronized retries
          const jitter = baseDelay * 0.2 * (Math.random() * 2 - 1);
          return Math.max(0, baseDelay + jitter);
        },
      },
      mutations: {
        // Retry failed mutations once with jitter
        retry: 1,
        retryDelay: () => {
          const baseDelay = 1000;
          const jitter = baseDelay * 0.2 * (Math.random() * 2 - 1);
          return Math.max(0, baseDelay + jitter);
        },
        // Network mode for mutations
        networkMode: "online",
      },
    },
  });
}
