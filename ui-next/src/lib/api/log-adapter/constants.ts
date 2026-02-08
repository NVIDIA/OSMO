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
 * Log Adapter Constants
 *
 * Centralized constants for log levels, colors, and field definitions.
 * Used by log viewer components and adapters.
 */

import { AlertCircle, Monitor, ListTree, RotateCcw, type LucideIcon } from "lucide-react";
import type { LogLevel, LogIOType, LogSourceType } from "@/lib/api/log-adapter/types";

// =============================================================================
// Log Levels
// =============================================================================

/**
 * Ordered list of log levels from least to most severe.
 * Order matters for filtering (e.g., "warn and above").
 */
export const LOG_LEVELS: readonly LogLevel[] = ["debug", "info", "warn", "error", "fatal"] as const;

/**
 * Log level severity index for comparison.
 * Higher number = more severe.
 */
export const LOG_LEVEL_SEVERITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  fatal: 4,
} as const;

/**
 * Human-readable labels for log levels.
 */
export const LOG_LEVEL_LABELS: Record<LogLevel, string> = {
  debug: "Debug",
  info: "Info",
  warn: "Warning",
  error: "Error",
  fatal: "Fatal",
} as const;

// =============================================================================
// Log Level Styles
// =============================================================================

/**
 * Style configuration for log levels.
 * Includes Tailwind classes for DOM rendering and hex colors for canvas/SVG.
 */
export interface LogLevelStyle {
  /** Background color class */
  bg: string;
  /** Text color class */
  text: string;
  /** Badge/chip text color (often same as text) */
  badge: string;
  /** Dot indicator color */
  dot: string;
  /** Border color class */
  border: string;
  /** Raw hex color for histogram bars and SVG */
  color: string;
  /** Darker hex color for strokes/borders */
  strokeColor: string;
}

/**
 * Tailwind styles and hex colors for each log level.
 * Follows the codebase pattern from status-styles.ts
 */
export const LOG_LEVEL_STYLES: Record<LogLevel, LogLevelStyle> = {
  debug: {
    bg: "bg-gray-100 dark:bg-zinc-800/60",
    text: "text-gray-600 dark:text-zinc-400",
    badge: "text-gray-600 dark:text-zinc-400",
    dot: "bg-gray-400 dark:bg-zinc-500",
    border: "border-gray-300 dark:border-zinc-600",
    color: "#71717a", // zinc-500
    strokeColor: "#52525b", // zinc-600
  },
  info: {
    bg: "bg-blue-50 dark:bg-blue-950/60",
    text: "text-blue-700 dark:text-blue-400",
    badge: "text-blue-700 dark:text-blue-400",
    dot: "bg-blue-500",
    border: "border-blue-400 dark:border-blue-500",
    color: "#3b82f6", // blue-500
    strokeColor: "#1d4ed8", // blue-700
  },
  warn: {
    bg: "bg-amber-50 dark:bg-amber-950/60",
    text: "text-amber-700 dark:text-amber-400",
    badge: "text-amber-700 dark:text-amber-400",
    dot: "bg-amber-500",
    border: "border-amber-400 dark:border-amber-500",
    color: "#f59e0b", // amber-500
    strokeColor: "#d97706", // amber-600
  },
  error: {
    bg: "bg-red-50 dark:bg-red-950/60",
    text: "text-red-700 dark:text-red-400",
    badge: "text-red-700 dark:text-red-400",
    dot: "bg-red-500",
    border: "border-red-400 dark:border-red-500",
    color: "#ef4444", // red-500
    strokeColor: "#b91c1c", // red-700
  },
  fatal: {
    bg: "bg-purple-50 dark:bg-purple-950/60",
    text: "text-purple-700 dark:text-purple-400",
    badge: "text-purple-700 dark:text-purple-400",
    dot: "bg-purple-500",
    border: "border-purple-400 dark:border-purple-500",
    color: "#a855f7", // purple-500
    strokeColor: "#7e22ce", // purple-700
  },
} as const;

/**
 * Get styles for a log level with fallback to debug styles.
 */
export function getLogLevelStyle(level: LogLevel | undefined): LogLevelStyle {
  return level ? LOG_LEVEL_STYLES[level] : LOG_LEVEL_STYLES.debug;
}

// =============================================================================
// IO Types
// =============================================================================

/**
 * All supported IO types for log output streams.
 * Note: "dump" is excluded as it's a special type for raw output (no timestamp/prefix).
 */
export const LOG_IO_TYPES: readonly LogIOType[] = [
  "stdout",
  "stderr",
  "osmo_ctrl",
  "download",
  "upload",
  "dump",
] as const;

/**
 * Human-readable labels for IO types.
 */
export const LOG_IO_TYPE_LABELS: Record<LogIOType, string> = {
  stdout: "Standard Output",
  stderr: "Standard Error",
  osmo_ctrl: "OSMO Control",
  download: "Download",
  upload: "Upload",
  dump: "Raw Output",
} as const;

// =============================================================================
// Source Types (User vs OSMO)
// =============================================================================

/**
 * IO types that belong to "user" source (user container output).
 */
export const USER_IO_TYPES: ReadonlySet<LogIOType> = new Set(["stdout", "stderr", "dump"]);

/**
 * IO types that belong to "osmo" source (OSMO infrastructure).
 */
export const OSMO_IO_TYPES: ReadonlySet<LogIOType> = new Set(["osmo_ctrl", "download", "upload"]);

/**
 * All supported source types.
 */
export const LOG_SOURCE_TYPES: readonly LogSourceType[] = ["user", "osmo"] as const;

/**
 * Human-readable labels for source types.
 */
export const LOG_SOURCE_TYPE_LABELS: Record<LogSourceType, string> = {
  user: "User",
  osmo: "System",
} as const;

/**
 * Derive source type from IO type.
 * User = stdout, stderr, dump (user's code output)
 * OSMO = osmo_ctrl, download, upload (OSMO infrastructure)
 */
export function getSourceType(ioType: LogIOType | undefined): LogSourceType {
  if (!ioType) return "user";
  return OSMO_IO_TYPES.has(ioType) ? "osmo" : "user";
}

// =============================================================================
// Field Definitions
// =============================================================================

/**
 * Field definition for filtering and faceting.
 */
export interface LogFieldDefinition {
  /** Field key in LogLabels */
  key: string;
  /** Human-readable label */
  label: string;
  /** Short label for compact display */
  shortLabel: string;
  /** Whether this field supports faceting */
  facetable: boolean;
  /** Whether this field is a label filter (fast in Loki) */
  isLabelFilter: boolean;
  /** Optional icon component for UI display */
  icon?: LucideIcon;
}

/**
 * Standard fields available for filtering and faceting.
 */
export const LOG_FIELDS: readonly LogFieldDefinition[] = [
  {
    key: "level",
    label: "Log Level",
    shortLabel: "Level",
    facetable: true,
    isLabelFilter: true,
    icon: AlertCircle,
  },
  {
    key: "source",
    label: "Source",
    shortLabel: "Source",
    facetable: true,
    isLabelFilter: true,
    icon: Monitor,
  },
  {
    key: "task",
    label: "Task Name",
    shortLabel: "Task",
    facetable: true,
    isLabelFilter: true,
    icon: ListTree,
  },
  {
    key: "retry",
    label: "Retry Attempt",
    shortLabel: "Retry",
    facetable: true,
    isLabelFilter: true,
    icon: RotateCcw,
  },
];

/**
 * Field keys that are label filters (fast filtering in Loki).
 */
export const LABEL_FILTER_FIELDS = LOG_FIELDS.filter((f) => f.isLabelFilter).map((f) => f.key);

/**
 * Field keys that are facetable.
 */
export const FACETABLE_FIELDS = LOG_FIELDS.filter((f) => f.facetable).map((f) => f.key);

/**
 * Lookup map for facetable field configurations.
 * Provides O(1) access to field config by key.
 */
export const FACET_FIELD_CONFIG: ReadonlyMap<string, LogFieldDefinition> = new Map(
  LOG_FIELDS.filter((f) => f.facetable).map((f) => [f.key, f]),
);

// =============================================================================
// Default Values
// =============================================================================

/**
 * Default query limits and pagination settings.
 */
export const LOG_QUERY_DEFAULTS = {
  /** Default number of entries per page */
  PAGE_SIZE: 500,
  /** Maximum entries to load before warning */
  MAX_ENTRIES_WARNING: 50_000,
  /** Maximum entries to load (hard limit) */
  MAX_ENTRIES_LIMIT: 100_000,
  /** Default histogram bucket count */
  HISTOGRAM_BUCKETS: 50,
  /** Context lines to show when expanding */
  CONTEXT_LINES: 5,
} as const;

/**
 * Default adapter capabilities for plain text adapter.
 */
export const PLAIN_TEXT_ADAPTER_CAPABILITIES = {
  labelFilteringOptimized: false,
  contentSearchOptimized: false,
  serverSideHistogram: false,
  serverSideFacets: false,
} as const;
