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
 * Log Adapter Types
 *
 * Canonical types for the log viewer, modeled after Loki's stream format
 * to enable future backend migration while working with current plain-text logs.
 *
 * Current backend parses into these shapes; Loki would return them natively.
 */

// =============================================================================
// Core Log Types
// =============================================================================

/**
 * Log severity levels.
 * Matches common logging frameworks and Loki conventions.
 */
export type LogLevel = "debug" | "info" | "warn" | "error" | "fatal";

/**
 * IO type for log output streams.
 * Identifies the source of the log line.
 */
export type LogIOType = "stdout" | "stderr" | "osmo_ctrl" | "download" | "upload";

/**
 * Labels attached to log entries - the key to Loki compatibility.
 * Keep this list small - Loki works best with low cardinality.
 *
 * Current: parsed from log line format
 * Loki: native stream labels
 */
export interface LogLabels {
  /** Workflow ID */
  workflow: string;
  /** Task name within workflow */
  task?: string;
  /** Retry attempt (string for Loki compat) */
  retry?: string;
  /** Parsed severity level */
  level?: LogLevel;
  /** Log output stream type */
  io_type?: LogIOType;
  /** Extensible for future labels */
  [key: string]: string | undefined;
}

/**
 * Log entry - modeled after Loki's stream format.
 * Current backend parses into this shape, Loki returns it natively.
 */
export interface LogEntry {
  /** Unique ID: timestamp-nanos + hash for current, Loki stream ID for future */
  id: string;
  /** Timestamp (Loki uses nanoseconds, we normalize to Date) */
  timestamp: Date;
  /** Raw log line as stored */
  line: string;
  /** Structured labels - the key to Loki compatibility */
  labels: LogLabels;
}

// =============================================================================
// Query Types
// =============================================================================

/**
 * Search mode for content filtering.
 */
export type LogSearchMode = "contains" | "regex";

/**
 * Query direction for pagination.
 */
export type LogQueryDirection = "forward" | "backward";

/**
 * Query parameters - maps cleanly to LogQL.
 */
export interface LogQuery {
  // Required context
  /** Workflow ID to fetch logs for */
  workflowId: string;

  // Label filters (instant in Loki)
  /** Filter by task name */
  taskName?: string;
  /** Filter by retry attempt ID */
  retryId?: number;
  /** Filter by log levels (multiple allowed) */
  levels?: LogLevel[];
  /** Filter by IO types (multiple allowed) */
  ioTypes?: LogIOType[];

  // Time range
  /** Start of time range */
  start?: Date;
  /** End of time range */
  end?: Date;

  // Content filter (slower in Loki, but supported)
  /** Text search query */
  search?: string;
  /** Search mode: contains or regex */
  searchMode?: LogSearchMode;

  // Pagination
  /** Maximum number of entries to return */
  limit?: number;
  /** Query direction */
  direction?: LogQueryDirection;
  /** Cursor for pagination */
  cursor?: string;
}

/**
 * Query result - same shape regardless of backend.
 */
export interface LogQueryResult {
  /** Log entries matching the query */
  entries: LogEntry[];
  /** Cursor for next page, if more results exist */
  nextCursor?: string;
  /** Whether more results are available */
  hasMore: boolean;
  /** Optional query statistics */
  stats?: LogQueryStats;
}

/**
 * Query statistics for debugging and monitoring.
 */
export interface LogQueryStats {
  /** Number of bytes scanned */
  scannedBytes?: number;
  /** Query execution time in milliseconds */
  queryTimeMs?: number;
}

// =============================================================================
// Histogram Types
// =============================================================================

/**
 * Histogram bucket for timeline visualization.
 * Contains counts per log level for stacked display.
 */
export interface HistogramBucket {
  /** Bucket start timestamp */
  timestamp: Date;
  /** Counts per log level */
  counts: Partial<Record<LogLevel, number>>;
  /** Total count for this bucket */
  total: number;
}

/**
 * Histogram query result.
 */
export interface HistogramResult {
  /** Time-ordered buckets */
  buckets: HistogramBucket[];
  /** Bucket interval in milliseconds */
  intervalMs: number;
}

// =============================================================================
// Facet Types
// =============================================================================

/**
 * Value with count for faceting.
 */
export interface FacetValue {
  /** The field value */
  value: string;
  /** Number of entries with this value */
  count: number;
}

/**
 * Field facet for the Fields pane.
 * Contains distinct values and counts for a field.
 */
export interface FieldFacet {
  /** Field name (e.g., "task", "level") */
  field: string;
  /** Distinct values with their counts */
  values: FacetValue[];
}

// =============================================================================
// Adapter Capabilities
// =============================================================================

/**
 * Adapter capabilities - UI uses for progressive enhancement.
 * Different backends have different optimization characteristics.
 */
export interface AdapterCapabilities {
  /** True = instant label filters (Loki), False = client-side filtering */
  labelFilteringOptimized: boolean;
  /** True = indexed content search, False = regex on full file */
  contentSearchOptimized: boolean;
  /** True = server computes histogram, False = computed client-side */
  serverSideHistogram: boolean;
  /** True = server computes facets, False = computed client-side */
  serverSideFacets: boolean;
  /** Max time range for efficient queries (for UI warnings) */
  maxEfficientRangeMs?: number;
}

// =============================================================================
// Adapter Interface
// =============================================================================

/**
 * The adapter interface - both current and future backends implement this.
 *
 * Implementations:
 * - PlainTextAdapter: Current backend, client-side filtering
 * - LokiAdapter (future): Server-side filtering and aggregation
 */
export interface LogAdapter {
  /** Capabilities of this adapter for progressive enhancement */
  readonly capabilities: AdapterCapabilities;

  /**
   * Query log entries with filtering and pagination.
   * @param params Query parameters
   * @returns Promise resolving to query results
   */
  query(params: LogQuery): Promise<LogQueryResult>;

  /**
   * Get histogram data for timeline visualization.
   * @param params Query parameters (excluding pagination)
   * @param buckets Number of histogram buckets (default: 50)
   * @returns Promise resolving to histogram data
   */
  histogram(
    params: Omit<LogQuery, "cursor" | "limit">,
    buckets?: number
  ): Promise<HistogramResult>;

  /**
   * Get facet data for the Fields pane.
   * @param params Query parameters (excluding pagination)
   * @param fields Fields to compute facets for
   * @returns Promise resolving to field facets
   */
  facets(params: Omit<LogQuery, "cursor" | "limit">, fields: string[]): Promise<FieldFacet[]>;
}

// =============================================================================
// Live Tailing Types
// =============================================================================

/**
 * Tail session state.
 */
export type TailStatus = "connecting" | "streaming" | "paused" | "disconnected" | "error";

/**
 * Tail session callbacks.
 */
export interface TailCallbacks {
  /** Called when new entries arrive */
  onEntries: (entries: LogEntry[]) => void;
  /** Called on status change */
  onStatus: (status: TailStatus) => void;
  /** Called on error */
  onError: (error: Error) => void;
}

/**
 * Tail session control.
 */
export interface TailSession {
  /** Current status */
  readonly status: TailStatus;
  /** Pause the tail */
  pause: () => void;
  /** Resume the tail */
  resume: () => void;
  /** Stop and cleanup */
  stop: () => void;
}
