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
 * Plain Text Log Adapter
 *
 * Implements the LogAdapter interface for the current OSMO backend that
 * returns plain text logs. Provides client-side filtering, histogram
 * computation, and facet extraction.
 *
 * This adapter:
 * - Fetches plain text logs from /api/workflow/{name}/logs
 * - Parses logs using log-parser
 * - Indexes and filters using log-index
 * - Computes histograms and facets client-side
 *
 * Future Loki adapter will replace this with server-side operations.
 */

import type { LogAdapter, LogQuery, LogQueryResult, HistogramResult, FieldFacet, AdapterCapabilities } from "../types";
import { PLAIN_TEXT_ADAPTER_CAPABILITIES, LOG_QUERY_DEFAULTS } from "../constants";
import { parseLogBatch } from "./log-parser";
import { LogIndex, type LogIndexFilterOptions } from "./log-index";

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
  /** Dev-only URL params to append to all requests (e.g., { log_scenario: "error-heavy" }) */
  devParams?: Record<string, string>;
}

/**
 * Cache entry for loaded logs.
 */
interface LogCache {
  /** Workflow ID */
  workflowId: string;
  /** Log index with all entries */
  index: LogIndex;
  /** When the cache was last updated */
  lastUpdated: Date;
  /** Whether the workflow is still running (logs may update) */
  isStreaming: boolean;
}

// =============================================================================
// Plain Text Adapter
// =============================================================================

/**
 * Adapter for plain text logs from the current OSMO backend.
 *
 * Features:
 * - Lazy loading: logs are fetched on first query
 * - Client-side filtering using LogIndex
 * - Cursor-based pagination with stable ordering
 * - Cache invalidation for streaming workflows
 */
export class PlainTextAdapter implements LogAdapter {
  readonly capabilities: AdapterCapabilities;

  private config: Required<PlainTextAdapterConfig>;
  private cache = new Map<string, LogCache>();

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
  // LogAdapter Interface
  // ===========================================================================

  /**
   * Queries log entries with filtering and pagination.
   *
   * @param params - Query parameters
   * @returns Query results with entries and pagination info
   */
  async query(params: LogQuery): Promise<LogQueryResult> {
    const index = await this.getOrLoadIndex(params.workflowId);

    // Build filter options from query params
    const filterOpts = this.buildFilterOptions(params);

    // Get filtered entries
    const allFiltered = index.filter(filterOpts);

    // Apply pagination
    const limit = params.limit ?? LOG_QUERY_DEFAULTS.PAGE_SIZE;
    const startIdx = params.cursor ? this.decodeCursor(params.cursor) : 0;

    // Handle direction
    let entries: typeof allFiltered;
    let nextCursor: string | undefined;
    let hasMore: boolean;

    if (params.direction === "backward") {
      // Backward: return entries before cursor, newest first
      const endIdx = params.cursor ? startIdx : allFiltered.length;
      const beginIdx = Math.max(0, endIdx - limit);
      entries = allFiltered.slice(beginIdx, endIdx).reverse();
      hasMore = beginIdx > 0;
      nextCursor = hasMore ? this.encodeCursor(beginIdx) : undefined;
    } else {
      // Forward (default): return entries after cursor, oldest first
      entries = allFiltered.slice(startIdx, startIdx + limit);
      hasMore = startIdx + limit < allFiltered.length;
      nextCursor = hasMore ? this.encodeCursor(startIdx + limit) : undefined;
    }

    return {
      entries,
      nextCursor,
      hasMore,
      stats: {
        queryTimeMs: 0, // Could measure actual time if needed
        scannedBytes: undefined,
      },
    };
  }

  /**
   * Gets histogram data for timeline visualization.
   * Computed client-side from the log index.
   *
   * @param params - Query parameters (excluding pagination)
   * @param numBuckets - Number of histogram buckets
   * @returns Histogram data
   */
  async histogram(
    params: Omit<LogQuery, "cursor" | "limit">,
    numBuckets: number = LOG_QUERY_DEFAULTS.HISTOGRAM_BUCKETS,
  ): Promise<HistogramResult> {
    const index = await this.getOrLoadIndex(params.workflowId);

    // For filtered histograms, we'd need to build a filtered index
    // For now, return the full histogram
    // TODO: Support filtered histograms if needed
    return index.getHistogram(numBuckets);
  }

  /**
   * Gets facet data for the Fields pane.
   * Computed client-side from the log index.
   *
   * @param params - Query parameters (excluding pagination)
   * @param fields - Fields to compute facets for
   * @returns Field facets
   */
  async facets(params: Omit<LogQuery, "cursor" | "limit">, fields: string[]): Promise<FieldFacet[]> {
    const index = await this.getOrLoadIndex(params.workflowId);

    // TODO: Support filtered facets if needed
    return index.getFacets(fields);
  }

  // ===========================================================================
  // Cache Management
  // ===========================================================================

  /**
   * Invalidates the cache for a workflow.
   * Call this when new logs are expected (e.g., streaming workflow).
   *
   * @param workflowId - Workflow ID to invalidate
   */
  invalidateCache(workflowId: string): void {
    this.cache.delete(workflowId);
  }

  /**
   * Clears all cached data.
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Checks if a workflow's logs are cached.
   *
   * @param workflowId - Workflow ID to check
   */
  isCached(workflowId: string): boolean {
    return this.cache.has(workflowId);
  }

  // ===========================================================================
  // Private Methods
  // ===========================================================================

  /**
   * Gets or loads the log index for a workflow.
   */
  private async getOrLoadIndex(workflowId: string): Promise<LogIndex> {
    let cached = this.cache.get(workflowId);

    if (!cached) {
      // Load logs for the first time
      const logText = await this.fetchLogs(workflowId);
      const entries = parseLogBatch(logText, workflowId);

      const index = new LogIndex();
      index.addEntries(entries);

      cached = {
        workflowId,
        index,
        lastUpdated: new Date(),
        isStreaming: false, // Could be determined from workflow status
      };

      this.cache.set(workflowId, cached);
    }

    return cached.index;
  }

  /**
   * Fetches raw log text from the backend.
   */
  private async fetchLogs(workflowId: string): Promise<string> {
    let url = `${this.config.baseUrl}/api/workflow/${encodeURIComponent(workflowId)}/logs`;

    // Append dev params for testing (e.g., log_scenario)
    if (this.config.devParams && Object.keys(this.config.devParams).length > 0) {
      const params = new URLSearchParams(this.config.devParams);
      url += `?${params.toString()}`;
    }

    const response = await this.config.fetchFn(url, {
      method: "GET",
      headers: {
        Accept: "text/plain",
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch logs: ${response.status} ${response.statusText}`);
    }

    return response.text();
  }

  /**
   * Builds filter options from query parameters.
   */
  private buildFilterOptions(params: LogQuery): LogIndexFilterOptions {
    const opts: LogIndexFilterOptions = {};

    if (params.levels?.length) {
      opts.levels = params.levels;
    }

    if (params.taskName) {
      opts.tasks = [params.taskName];
    }

    if (params.ioTypes?.length) {
      opts.ioTypes = params.ioTypes;
    }

    if (params.search) {
      opts.search = params.search;
      opts.searchRegex = params.searchMode === "regex";
    }

    if (params.start) {
      opts.start = params.start;
    }

    if (params.end) {
      opts.end = params.end;
    }

    return opts;
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
