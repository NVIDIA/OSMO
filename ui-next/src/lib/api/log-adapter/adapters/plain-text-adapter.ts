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
 * Plain Text Log Adapter (Stateless)
 *
 * Implements the LogAdapter interface for the current OSMO backend that
 * returns plain text logs. This adapter is stateless - all caching is
 * handled by React Query at the hook level.
 *
 * This adapter:
 * - Fetches plain text logs from /api/workflow/{name}/logs
 * - Parses logs using log-parser
 * - Filters and computes derived data using pure functions
 *
 * Future Loki adapter will perform these operations server-side.
 */

import type {
  LogAdapter,
  LogQuery,
  LogQueryResult,
  LogDataResult,
  HistogramResult,
  FieldFacet,
  AdapterCapabilities,
  LogEntry,
} from "../types";
import { PLAIN_TEXT_ADAPTER_CAPABILITIES, LOG_QUERY_DEFAULTS, FACETABLE_FIELDS } from "../constants";
import { parseLogBatch } from "./log-parser";
import { filterEntries, computeHistogram, computeFacets, type FilterParams } from "./compute";

// =============================================================================
// Types
// =============================================================================

/**
 * Configuration for the PlainTextAdapter.
 */
export interface PlainTextAdapterConfig {
  /** Base URL for API requests (default: empty for same-origin) */
  baseUrl?: string;
  /** Custom fetch function for testing */
  fetchFn?: typeof fetch;
  /** Optional URL params to append to all requests */
  devParams?: Record<string, string>;
}

/**
 * Parameters for the unified queryAll method.
 */
export interface QueryAllParams {
  /** Workflow ID to fetch logs for */
  workflowId: string;
  /** Task group ID for group-scoped queries (optional) */
  groupId?: string;
  /** Task ID for task-scoped queries (optional) */
  taskId?: string;
  /** Filter by log levels */
  levels?: FilterParams["levels"];
  /** Filter by task names */
  tasks?: FilterParams["tasks"];
  /** Filter by retry attempts */
  retries?: FilterParams["retries"];
  /** Filter by source types */
  sources?: FilterParams["sources"];
  /** Text search query */
  search?: string;
  /** Use regex for search */
  searchRegex?: boolean;
  /** Start of time range */
  start?: Date;
  /** End of time range */
  end?: Date;
  /** Number of histogram buckets */
  histogramBuckets?: number;
  /** Fields to compute facets for */
  facetFields?: string[];
}

// =============================================================================
// Plain Text Adapter
// =============================================================================

/**
 * Stateless adapter for plain text logs from the current OSMO backend.
 *
 * This adapter fetches and processes logs on every call. Caching is handled
 * externally by React Query, enabling:
 * - SSR via HydrationBoundary
 * - Automatic cache invalidation
 * - Single source of truth
 */
export class PlainTextAdapter implements LogAdapter {
  readonly capabilities: AdapterCapabilities;

  private config: Required<PlainTextAdapterConfig>;

  /**
   * Creates a new PlainTextAdapter.
   *
   * @param config - Adapter configuration
   */
  constructor(config: PlainTextAdapterConfig = {}) {
    this.config = {
      baseUrl: config.baseUrl ?? "",
      fetchFn: config.fetchFn ?? fetch.bind(globalThis),
      devParams: config.devParams ?? {},
    };
    this.capabilities = { ...PLAIN_TEXT_ADAPTER_CAPABILITIES };
  }

  // ===========================================================================
  // Unified Query Method (New - Preferred)
  // ===========================================================================

  /**
   * Fetches and returns all log data in a single call.
   *
   * This is the preferred method for the new useLogData() hook.
   * Returns entries, histogram, and facets together for efficient caching.
   *
   * @param params - Query parameters
   * @param signal - Optional AbortSignal for request cancellation
   * @returns Promise resolving to unified log data result
   */
  async queryAll(params: QueryAllParams, signal?: AbortSignal): Promise<LogDataResult> {
    // Fetch and parse logs
    const logText = await this.fetchLogs(params.workflowId, params.groupId, params.taskId, signal);
    const allEntries = parseLogBatch(logText, params.workflowId);

    // If aborted after fetch but before heavy processing, stop here
    if (signal?.aborted) {
      throw new Error("Log processing aborted");
    }

    // Build filter params
    const filterParams: FilterParams = {
      levels: params.levels,
      tasks: params.tasks,
      retries: params.retries,
      sources: params.sources,
      search: params.search,
      searchRegex: params.searchRegex,
      start: params.start,
      end: params.end,
    };

    // Filter entries
    const filteredEntries = filterEntries(allEntries, filterParams);

    // Compute histogram from ALL entries (shows full time range)
    const histogram = computeHistogram(allEntries, params.histogramBuckets ?? LOG_QUERY_DEFAULTS.HISTOGRAM_BUCKETS);

    // Compute facets from ALL entries (shows all available values)
    const facets = computeFacets(allEntries, params.facetFields ?? FACETABLE_FIELDS);

    return {
      entries: filteredEntries,
      histogram,
      facets,
      stats: {
        totalCount: allEntries.length,
        filteredCount: filteredEntries.length,
      },
    };
  }

  // ===========================================================================
  // LogAdapter Interface (Legacy - for backward compatibility)
  // ===========================================================================

  /**
   * Queries log entries with filtering and pagination.
   *
   * @deprecated Use queryAll() for new code. This method is kept for
   * backward compatibility with existing hooks during migration.
   *
   * @param params - Query parameters
   * @param signal - Optional AbortSignal for request cancellation
   * @returns Query results with entries and pagination info
   */
  async query(params: LogQuery, signal?: AbortSignal): Promise<LogQueryResult> {
    // Fetch and parse logs
    const logText = await this.fetchLogs(params.workflowId, undefined, undefined, signal);
    const allEntries = parseLogBatch(logText, params.workflowId);

    // If aborted after fetch but before heavy processing, stop here
    if (signal?.aborted) {
      throw new Error("Log processing aborted");
    }

    // Build filter params
    const filterParams: FilterParams = {
      levels: params.levels,
      tasks: params.taskName ? [params.taskName] : undefined,
      sources: params.sources,
      search: params.search,
      searchRegex: params.searchMode === "regex",
      start: params.start,
      end: params.end,
    };

    // Filter entries
    const filteredEntries = filterEntries(allEntries, filterParams);

    // Apply pagination
    const limit = params.limit ?? LOG_QUERY_DEFAULTS.PAGE_SIZE;
    const startIdx = params.cursor ? this.decodeCursor(params.cursor) : 0;

    // Handle direction
    let entries: LogEntry[];
    let nextCursor: string | undefined;
    let hasMore: boolean;

    if (params.direction === "backward") {
      const endIdx = params.cursor ? startIdx : filteredEntries.length;
      const beginIdx = Math.max(0, endIdx - limit);
      entries = filteredEntries.slice(beginIdx, endIdx).reverse();
      hasMore = beginIdx > 0;
      nextCursor = hasMore ? this.encodeCursor(beginIdx) : undefined;
    } else {
      entries = filteredEntries.slice(startIdx, startIdx + limit);
      hasMore = startIdx + limit < filteredEntries.length;
      nextCursor = hasMore ? this.encodeCursor(startIdx + limit) : undefined;
    }

    return {
      entries,
      nextCursor,
      hasMore,
      stats: {
        queryTimeMs: 0,
        scannedBytes: undefined,
      },
    };
  }

  /**
   * Gets histogram data for timeline visualization.
   *
   * @deprecated Use queryAll() for new code.
   *
   * @param params - Query parameters (excluding pagination)
   * @param numBuckets - Number of histogram buckets
   * @param signal - Optional AbortSignal for request cancellation
   * @returns Histogram data
   */
  async histogram(
    params: Omit<LogQuery, "cursor" | "limit">,
    numBuckets: number = LOG_QUERY_DEFAULTS.HISTOGRAM_BUCKETS,
    signal?: AbortSignal,
  ): Promise<HistogramResult> {
    const logText = await this.fetchLogs(params.workflowId, undefined, undefined, signal);
    const allEntries = parseLogBatch(logText, params.workflowId);

    if (signal?.aborted) {
      throw new Error("Log processing aborted");
    }

    return computeHistogram(allEntries, numBuckets);
  }

  /**
   * Gets facet data for the Fields pane.
   *
   * @deprecated Use queryAll() for new code.
   *
   * @param params - Query parameters (excluding pagination)
   * @param fields - Fields to compute facets for
   * @param signal - Optional AbortSignal for request cancellation
   * @returns Field facets
   */
  async facets(
    params: Omit<LogQuery, "cursor" | "limit">,
    fields: string[],
    signal?: AbortSignal,
  ): Promise<FieldFacet[]> {
    const logText = await this.fetchLogs(params.workflowId, undefined, undefined, signal);
    const allEntries = parseLogBatch(logText, params.workflowId);

    if (signal?.aborted) {
      throw new Error("Log processing aborted");
    }

    return computeFacets(allEntries, fields);
  }

  // ===========================================================================
  // Private Methods
  // ===========================================================================

  /**
   * Fetches raw log text from the backend.
   *
   * @param workflowId - Workflow ID to fetch logs for
   * @param groupId - Optional task group ID for group-scoped queries
   * @param taskId - Optional task ID for task-scoped queries
   * @param signal - Optional AbortSignal for request cancellation
   */
  private async fetchLogs(
    workflowId: string,
    groupId?: string,
    taskId?: string,
    signal?: AbortSignal,
  ): Promise<string> {
    let url = `${this.config.baseUrl}/api/workflow/${encodeURIComponent(workflowId)}/logs`;

    // Build query params
    const urlParams = new URLSearchParams(this.config.devParams);

    // Add scope parameters if provided
    if (groupId) {
      urlParams.set("group_id", groupId);
    }
    if (taskId) {
      urlParams.set("task_id", taskId);
    }

    // Append URL params if any exist
    const paramString = urlParams.toString();
    if (paramString) {
      url += `?${paramString}`;
    }

    const response = await this.config.fetchFn(url, {
      method: "GET",
      headers: {
        Accept: "text/plain",
      },
      signal,
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch logs: ${response.status} ${response.statusText}`);
    }

    return response.text();
  }

  /**
   * Encodes a cursor position as a string.
   */
  private encodeCursor(position: number): string {
    return btoa(String(position));
  }

  /**
   * Decodes a cursor string to a position.
   */
  private decodeCursor(cursor: string): number {
    try {
      return parseInt(atob(cursor), 10);
    } catch {
      return 0;
    }
  }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Creates a PlainTextAdapter instance.
 * Convenience function for consistent instantiation.
 *
 * @param config - Adapter configuration
 * @returns PlainTextAdapter instance
 */
export function createPlainTextAdapter(config?: PlainTextAdapterConfig): PlainTextAdapter {
  return new PlainTextAdapter(config);
}
