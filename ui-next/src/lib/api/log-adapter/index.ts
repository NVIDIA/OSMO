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
  LogLabels,
  LogEntry,
  // Query types
  LogSearchMode,
  LogQueryDirection,
  LogQuery,
  LogQueryResult,
  LogQueryStats,
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
  TailSession,
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
  // Index class
  LogIndex,
  // Plain Text Adapter
  PlainTextAdapter,
  createPlainTextAdapter,
} from "./adapters";

export type { LogIndexFilterOptions, PlainTextAdapterConfig } from "./adapters";
