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

/**
 * Status Styling System
 *
 * Centralized status category styles for consistent theming across the UI.
 * Features define their own status-to-category mappings while sharing the same
 * visual language.
 *
 * @example
 * ```ts
 * // Define feature-specific status mapping
 * const POOL_STATUS_CATEGORY: Record<PoolStatus, StatusStyleCategory> = {
 *   [PoolStatus.ONLINE]: "success",
 *   [PoolStatus.MAINTENANCE]: "warning",
 *   [PoolStatus.OFFLINE]: "danger",
 * };
 *
 * // Get styles for a status
 * const styles = STATUS_CATEGORY_STYLES[POOL_STATUS_CATEGORY[pool.status]];
 * // { bg: "...", text: "...", icon: "...", dot: "...", border: "..." }
 * ```
 */

// =============================================================================
// Types
// =============================================================================

/**
 * Semantic status categories that map to visual styles.
 * - success: Positive states (online, completed, healthy)
 * - warning: Attention needed (maintenance, pending review)
 * - danger: Error states (offline, failed, error)
 * - info: Active/in-progress states (running, processing)
 * - neutral: Default/pending states (waiting, queued)
 * - unknown: Fallback for unrecognized states
 */
export type StatusStyleCategory = "success" | "warning" | "danger" | "info" | "neutral" | "unknown";

/**
 * Base styling for status elements using Tailwind classes.
 */
export interface StatusStyle {
  /** Background color class (e.g., badges, chips) */
  bg: string;
  /** Text color class */
  text: string;
  /** Icon color class */
  icon: string;
  /** Status dot/indicator color class */
  dot: string;
  /** Border color class */
  border: string;
}

/**
 * Extended status style with raw colors for canvas rendering (ReactFlow, etc.)
 */
export interface StatusStyleWithColors extends StatusStyle {
  /** Raw hex color for canvas elements (e.g., ReactFlow nodes) */
  color: string;
  /** Raw hex color for strokes/borders on canvas */
  strokeColor: string;
}

// =============================================================================
// Category Styles
// =============================================================================

/**
 * Base status category styles using Tailwind classes.
 * Use these for badges, chips, and other DOM elements.
 */
export const STATUS_CATEGORY_STYLES: Record<StatusStyleCategory, StatusStyle> = {
  success: {
    bg: "bg-emerald-50 dark:bg-emerald-950/60",
    text: "text-emerald-700 dark:text-emerald-400",
    icon: "text-emerald-500 dark:text-emerald-400",
    dot: "bg-emerald-500",
    border: "border-emerald-400 dark:border-emerald-600",
  },
  warning: {
    bg: "bg-amber-50 dark:bg-amber-950/60",
    text: "text-amber-700 dark:text-amber-400",
    icon: "text-amber-500 dark:text-amber-400",
    dot: "bg-amber-500",
    border: "border-amber-400 dark:border-amber-500",
  },
  danger: {
    bg: "bg-red-50 dark:bg-red-950/60",
    text: "text-red-700 dark:text-red-400",
    icon: "text-red-500 dark:text-red-400",
    dot: "bg-red-500",
    border: "border-red-400 dark:border-red-500",
  },
  info: {
    bg: "bg-blue-50 dark:bg-blue-950/60",
    text: "text-blue-700 dark:text-blue-400",
    icon: "text-blue-500 dark:text-blue-400",
    dot: "bg-blue-500",
    border: "border-blue-400 dark:border-blue-500",
  },
  neutral: {
    bg: "bg-gray-100 dark:bg-zinc-800/60",
    text: "text-gray-600 dark:text-zinc-400",
    icon: "text-gray-500 dark:text-zinc-500",
    dot: "bg-gray-400 dark:bg-zinc-500",
    border: "border-gray-300 dark:border-zinc-600",
  },
  unknown: {
    bg: "bg-amber-50 dark:bg-amber-950/60",
    text: "text-amber-700 dark:text-amber-400",
    icon: "text-amber-500 dark:text-amber-400",
    dot: "bg-amber-500",
    border: "border-amber-400 dark:border-amber-500",
  },
} as const;

/**
 * Extended status category styles with raw hex colors for canvas rendering.
 * Use these when you need to render in non-DOM contexts (ReactFlow, Canvas, etc.)
 */
export const STATUS_CATEGORY_STYLES_WITH_COLORS: Record<StatusStyleCategory, StatusStyleWithColors> = {
  success: {
    ...STATUS_CATEGORY_STYLES.success,
    color: "#10b981",
    strokeColor: "#047857",
  },
  warning: {
    ...STATUS_CATEGORY_STYLES.warning,
    color: "#f59e0b",
    strokeColor: "#d97706",
  },
  danger: {
    ...STATUS_CATEGORY_STYLES.danger,
    color: "#ef4444",
    strokeColor: "#b91c1c",
  },
  info: {
    ...STATUS_CATEGORY_STYLES.info,
    color: "#3b82f6",
    strokeColor: "#1d4ed8",
  },
  neutral: {
    ...STATUS_CATEGORY_STYLES.neutral,
    color: "#71717a",
    strokeColor: "#52525b",
  },
  unknown: {
    ...STATUS_CATEGORY_STYLES.unknown,
    color: "#f59e0b",
    strokeColor: "#d97706",
  },
} as const;

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Create a status style getter function for a feature.
 *
 * @param categoryMap - Mapping from status values to style categories
 * @param defaultCategory - Fallback category for unknown statuses
 * @returns Function to get styles for a status value
 *
 * @example
 * ```ts
 * const getPoolStatusStyle = createStatusStyleGetter({
 *   [PoolStatus.ONLINE]: "success",
 *   [PoolStatus.MAINTENANCE]: "warning",
 *   [PoolStatus.OFFLINE]: "danger",
 * });
 *
 * const styles = getPoolStatusStyle(pool.status);
 * ```
 */
export function createStatusStyleGetter<TStatus extends string>(
  categoryMap: Record<TStatus, StatusStyleCategory>,
  defaultCategory: StatusStyleCategory = "unknown",
): (status: TStatus | string) => StatusStyle {
  return (status: TStatus | string): StatusStyle => {
    const category = categoryMap[status as TStatus] ?? defaultCategory;
    return STATUS_CATEGORY_STYLES[category];
  };
}

/**
 * Create a status style getter with canvas colors for a feature.
 *
 * @param categoryMap - Mapping from status values to style categories
 * @param defaultCategory - Fallback category for unknown statuses
 * @returns Function to get styles (with hex colors) for a status value
 */
export function createStatusStyleWithColorsGetter<TStatus extends string>(
  categoryMap: Record<TStatus, StatusStyleCategory>,
  defaultCategory: StatusStyleCategory = "unknown",
): (status: TStatus | string) => StatusStyleWithColors {
  return (status: TStatus | string): StatusStyleWithColors => {
    const category = categoryMap[status as TStatus] ?? defaultCategory;
    return STATUS_CATEGORY_STYLES_WITH_COLORS[category];
  };
}

// =============================================================================
// Legacy Badge Styles (for pools feature compatibility)
// =============================================================================

/**
 * Legacy badge style structure used by pools feature.
 * Maps to STATUS_CATEGORY_STYLES but with nested badge structure.
 */
export interface LegacyStatusStyle {
  dot: string;
  badge: {
    bg: string;
    text: string;
    icon: string;
  };
}

/**
 * Convert category styles to legacy badge format.
 *
 * @param category - The status category
 * @returns Legacy-formatted status style
 */
export function toLegacyBadgeStyle(category: StatusStyleCategory): LegacyStatusStyle {
  const style = STATUS_CATEGORY_STYLES[category];
  return {
    dot: style.dot,
    badge: {
      bg: style.bg,
      text: style.text,
      icon: style.icon,
    },
  };
}

/**
 * Pre-computed legacy badge styles for common categories.
 * Use these directly in pool status displays.
 */
export const LEGACY_STATUS_STYLES = {
  success: toLegacyBadgeStyle("success"),
  warning: toLegacyBadgeStyle("warning"),
  danger: toLegacyBadgeStyle("danger"),
  info: toLegacyBadgeStyle("info"),
  neutral: toLegacyBadgeStyle("neutral"),
} as const;
