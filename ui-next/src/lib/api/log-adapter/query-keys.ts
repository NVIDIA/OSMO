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
 * Log Data Query Keys
 *
 * Shared query key factory for log data queries.
 * This file is used by both server (prefetch) and client (hooks).
 *
 * NOTE: This file intentionally does NOT have "use client" so it can
 * be imported from server components.
 */

import type { LogLevel, LogSourceType } from "./types";

// =============================================================================
// Types
// =============================================================================

/**
 * Parameters used to build the query key.
 * Matches the params used by useLogData and prefetchLogData.
 */
export interface LogDataQueryKeyParams {
  /** Workflow ID to fetch logs for */
  workflowId: string;
  /** Task group ID for group-scoped queries (optional) */
  groupId?: string;
  /** Task ID for task-scoped queries (optional) */
  taskId?: string;
  /** Filter by log levels */
  levels?: LogLevel[];
  /** Filter by task names */
  tasks?: string[];
  /** Filter by retry attempts */
  retries?: string[];
  /** Filter by source types (user vs system) */
  sources?: LogSourceType[];
  /** Text search query */
  search?: string;
  /** Use regex for search */
  searchRegex?: boolean;
  /** Start of time range */
  start?: Date;
  /** End of time range */
  end?: Date;
  /** Number of histogram buckets (default: 50) */
  histogramBuckets?: number;
  /** Fields to compute facets for (default: FACETABLE_FIELDS) */
  facetFields?: string[];
}

// =============================================================================
// Query Key Factory
// =============================================================================

/**
 * Creates a stable query key for log data queries.
 *
 * The key includes all filter parameters to ensure different filters
 * get different cache entries. This function is used by both:
 * - Server: prefetchLogData() for SSR
 * - Client: useLogData() hook
 *
 * @param params - Query parameters
 * @returns Stable query key array
 */
export function createLogDataQueryKey(params: LogDataQueryKeyParams): readonly unknown[] {
  return [
    "log-data",
    params.workflowId,
    {
      groupId: params.groupId,
      taskId: params.taskId,
      levels: params.levels,
      tasks: params.tasks,
      retries: params.retries,
      sources: params.sources,
      search: params.search,
      searchRegex: params.searchRegex,
      start: params.start?.toISOString(),
      end: params.end?.toISOString(),
      histogramBuckets: params.histogramBuckets,
      facetFields: params.facetFields,
    },
  ] as const;
}
