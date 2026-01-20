// Copyright (c) 2026, NVIDIA CORPORATION. All rights reserved.
//
// NVIDIA CORPORATION and its licensors retain all intellectual property
// and proprietary rights in and to this software, related documentation
// and any modifications thereto. Any use, reproduction, disclosure or
// distribution of this software and related documentation without an express
// license agreement from NVIDIA CORPORATION is strictly prohibited.

/**
 * Log Viewer Level Utilities
 *
 * UI-specific utilities for log levels including colors, icons, and badges.
 * Uses the canonical LOG_LEVEL_STYLES from log-adapter for consistency.
 */

import type { LogLevel } from "@/lib/api/log-adapter";
import { LOG_LEVELS, LOG_LEVEL_STYLES, LOG_LEVEL_LABELS, getLogLevelStyle } from "@/lib/api/log-adapter";
import { cn } from "@/lib/utils";

// =============================================================================
// Re-exports for convenience
// =============================================================================

export { LOG_LEVELS, LOG_LEVEL_STYLES, LOG_LEVEL_LABELS, getLogLevelStyle };
export type { LogLevel };

// =============================================================================
// Level Badge Utilities
// =============================================================================

/**
 * Pre-computed CSS classes for level badges.
 * Computed at module load to avoid calling cn() on every row render.
 */
const LEVEL_BADGE_BASE_CLASSES = "rounded px-1.5 py-0.5 text-xs font-medium border";

const LEVEL_BADGE_CLASSES: ReadonlyMap<LogLevel | undefined, string> = new Map([
  ...LOG_LEVELS.map((level) => {
    const style = LOG_LEVEL_STYLES[level];
    return [level, cn(LEVEL_BADGE_BASE_CLASSES, style.bg, style.text, style.border)] as const;
  }),
  // Fallback for undefined uses debug styles
  [
    undefined,
    cn(LEVEL_BADGE_BASE_CLASSES, LOG_LEVEL_STYLES.debug.bg, LOG_LEVEL_STYLES.debug.text, LOG_LEVEL_STYLES.debug.border),
  ],
]);

/**
 * Get CSS classes for a level badge.
 * Returns combined background, text, and border classes.
 * Uses pre-computed classes for O(1) lookup.
 */
export function getLevelBadgeClasses(level: LogLevel | undefined): string {
  return LEVEL_BADGE_CLASSES.get(level) ?? LEVEL_BADGE_CLASSES.get(undefined)!;
}

/**
 * Pre-computed CSS classes for level dot indicators.
 */
const LEVEL_DOT_BASE_CLASSES = "size-2 rounded-full";

const LEVEL_DOT_CLASSES: ReadonlyMap<LogLevel | undefined, string> = new Map([
  ...LOG_LEVELS.map((level) => {
    const style = LOG_LEVEL_STYLES[level];
    return [level, cn(LEVEL_DOT_BASE_CLASSES, style.dot)] as const;
  }),
  // Fallback for undefined uses debug styles
  [undefined, cn(LEVEL_DOT_BASE_CLASSES, LOG_LEVEL_STYLES.debug.dot)],
]);

/**
 * Get CSS classes for a level dot indicator.
 * Uses pre-computed classes for O(1) lookup.
 */
export function getLevelDotClasses(level: LogLevel | undefined): string {
  return LEVEL_DOT_CLASSES.get(level) ?? LEVEL_DOT_CLASSES.get(undefined)!;
}

/**
 * Get the label for a log level.
 */
export function getLevelLabel(level: LogLevel | undefined): string {
  if (!level) return "Unknown";
  return LOG_LEVEL_LABELS[level];
}

/**
 * Get level label for display.
 */
export function getLevelAbbrev(level: LogLevel | undefined): string {
  switch (level) {
    case "debug":
      return "DEBUG";
    case "info":
      return "INFO";
    case "warn":
      return "WARN";
    case "error":
      return "ERROR";
    case "fatal":
      return "FATAL";
    default:
      return "???";
  }
}

// =============================================================================
// Level Filtering Utilities
// =============================================================================

/**
 * Check if a log level is at or above a minimum severity.
 * Useful for "error and above" type filtering.
 */
export function isLevelAtLeast(level: LogLevel | undefined, minLevel: LogLevel): boolean {
  if (!level) return false;
  const levelIndex = LOG_LEVELS.indexOf(level);
  const minIndex = LOG_LEVELS.indexOf(minLevel);
  return levelIndex >= minIndex;
}

/**
 * Get all levels at or above a minimum severity.
 * Returns levels in severity order (lowest to highest).
 */
export function getLevelsAtLeast(minLevel: LogLevel): LogLevel[] {
  const minIndex = LOG_LEVELS.indexOf(minLevel);
  return LOG_LEVELS.slice(minIndex) as LogLevel[];
}

// =============================================================================
// Row Styling
// =============================================================================

/**
 * Get CSS classes for a log entry row based on level.
 * Provides subtle background tinting for errors/warnings.
 */
export function getLogRowClasses(level: LogLevel | undefined, options?: { expanded?: boolean }): string {
  const baseClasses = cn(
    "group relative",
    "px-3 py-1",
    "hover:bg-muted/50",
    "transition-colors duration-75",
    options?.expanded && "bg-muted/30",
  );

  // Add subtle left border for severity indication
  switch (level) {
    case "error":
    case "fatal":
      return cn(baseClasses, "border-l-2 border-l-red-500/50");
    case "warn":
      return cn(baseClasses, "border-l-2 border-l-amber-500/50");
    default:
      return cn(baseClasses, "border-l-2 border-l-transparent");
  }
}
