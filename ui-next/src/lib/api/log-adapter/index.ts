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
 * Log Adapter Layer
 *
 * Provides a unified interface for log data access, abstracting backend differences.
 * Currently implements PlainTextAdapter for existing backend; designed for future
 * Loki migration.
 *
 * Usage:
 * ```typescript
 * // Types
 * import type { LogEntry, LogQuery, LogAdapter } from "@/lib/api/log-adapter";
 *
 * // Constants
 * import { LOG_LEVELS, LOG_LEVEL_STYLES, getLogLevelStyle } from "@/lib/api/log-adapter";
 *
 * // Hooks (client-side only)
 * import { useLogQuery, useLogTail, useLogFacets } from "@/lib/api/log-adapter/hooks";
 *
 * // Adapters
 * import { PlainTextAdapter, parseLogBatch } from "@/lib/api/log-adapter/adapters";
 * ```
 */

// =============================================================================
// Types
// =============================================================================

export type {
  // Core log types
  LogLevel,
  LogIOType,
  LogSourceType,
  LogLabels,
  LogEntry,
  // Query types
  LogSearchMode,
  LogQueryDirection,
  LogQuery,
  LogQueryResult,
  LogQueryStats,
  // Unified result type
  LogDataResult,
  // Histogram types
  HistogramBucket,
  HistogramResult,
  // Facet types
  FacetValue,
  FieldFacet,
  // Adapter types
  AdapterCapabilities,
  LogAdapter,
  // Tail types
  TailStatus,
  TailCallbacks,
} from "./types";

// =============================================================================
// Constants
// =============================================================================

export {
  // Log levels
  LOG_LEVELS,
  LOG_LEVEL_SEVERITY,
  LOG_LEVEL_LABELS,
  // Log level styles
  LOG_LEVEL_STYLES,
  getLogLevelStyle,
  // IO types
  LOG_IO_TYPES,
  LOG_IO_TYPE_LABELS,
  // Source types (user vs osmo)
  LOG_SOURCE_TYPES,
  LOG_SOURCE_TYPE_LABELS,
  USER_IO_TYPES,
  OSMO_IO_TYPES,
  getSourceType,
  // Field definitions
  LOG_FIELDS,
  LABEL_FILTER_FIELDS,
  FACETABLE_FIELDS,
  // Defaults
  LOG_QUERY_DEFAULTS,
  PLAIN_TEXT_ADAPTER_CAPABILITIES,
} from "./constants";

export type { LogLevelStyle, LogFieldDefinition } from "./constants";

// =============================================================================
// Adapters (re-export for convenience, but prefer direct import for tree-shaking)
// =============================================================================

export {
  // Parser functions
  parseLogLine,
  parseLogBatch,
  stripAnsi,
  formatLogLine,
  // Compute functions (stateless, SSR-compatible)
  filterEntries,
  computeHistogram,
  computeFacets,
  // Plain Text Adapter
  PlainTextAdapter,
  createPlainTextAdapter,
} from "./adapters";

export type { FilterParams, PlainTextAdapterConfig, QueryAllParams } from "./adapters";

// =============================================================================
// Hooks (client-side only)
// =============================================================================

export {
  // Adapter access
  useLogAdapter,
  // Unified data hook (fetches entries + histogram + facets in one call)
  useLogData,
  // Tail hook (streaming)
  useLogTail,
} from "./hooks";

// Query key factory (can be used in both server and client)
export { createLogDataQueryKey } from "./query-keys";
export type { LogDataQueryKeyParams } from "./query-keys";

export type { UseLogDataParams, UseLogDataReturn, UseLogTailParams, UseLogTailReturn } from "./hooks";
