/**
 * Copyright (c) 2025, NVIDIA CORPORATION. All rights reserved.
 *
 * NVIDIA CORPORATION and its licensors retain all intellectual property
 * and proprietary rights in and to this software, related documentation
 * and any modifications thereto. Any use, reproduction, disclosure or
 * distribution of this software and related documentation without an express
 * license agreement from NVIDIA CORPORATION is strictly prohibited.
 */

/**
 * Pools Page Constants
 *
 * Single source of truth for dimensions, styling, and configuration.
 * Pre-computed lookup maps for O(1) access.
 */

import { PoolStatus } from "@/lib/api/generated";

// =============================================================================
// Layout Dimensions
// =============================================================================

export const LAYOUT = {
  /** Default row height in pixels */
  ROW_HEIGHT: 48,
  /** Compact row height in pixels */
  ROW_HEIGHT_COMPACT: 32,
  /** Section header row height in pixels */
  SECTION_ROW_HEIGHT: 36,
  /** Table header height in pixels */
  HEADER_HEIGHT: 40,
  /** Toolbar height in pixels (search + controls) */
  TOOLBAR_HEIGHT: 56,
  /** Page padding in pixels */
  PAGE_PADDING: 24,
  /** Minimum table height in pixels */
  TABLE_MIN_HEIGHT: 400,
  /** Gap between columns in pixels */
  COLUMN_GAP: 24,
  /** Padding for cells */
  CELL_PADDING_X: 12,
} as const;

// =============================================================================
// Panel Configuration
// =============================================================================

export const PANEL = {
  /** Default panel width percentage */
  DEFAULT_WIDTH_PCT: 40,
  /** Minimum panel width percentage */
  MIN_WIDTH_PCT: 25,
  /** Maximum panel width percentage */
  MAX_WIDTH_PCT: 80,
  /** Quick snap width presets */
  WIDTH_PRESETS: [33, 50, 75] as const,
} as const;

// =============================================================================
// Status Display
// =============================================================================

export type StatusCategory = "online" | "maintenance" | "offline";

export interface StatusDisplay {
  category: StatusCategory;
  label: string;
  icon: string;
  sortOrder: number;
}

/**
 * Status display configuration.
 */
export const STATUS_DISPLAYS: Record<string, StatusDisplay> = {
  [PoolStatus.ONLINE]: {
    category: "online",
    label: "Online",
    icon: "🟢",
    sortOrder: 0,
  },
  [PoolStatus.MAINTENANCE]: {
    category: "maintenance",
    label: "Maintenance",
    icon: "🟡",
    sortOrder: 1,
  },
  [PoolStatus.OFFLINE]: {
    category: "offline",
    label: "Offline",
    icon: "🔴",
    sortOrder: 2,
  },
} as const;

/**
 * Get status display info.
 */
export function getStatusDisplay(status: string): StatusDisplay {
  return (
    STATUS_DISPLAYS[status] ?? {
      category: "offline" as StatusCategory,
      label: status,
      icon: "⚪",
      sortOrder: 99,
    }
  );
}

/**
 * Status sort order for grouping.
 */
export const STATUS_ORDER = [PoolStatus.ONLINE, PoolStatus.MAINTENANCE, PoolStatus.OFFLINE];

// =============================================================================
// Status Styling (data-attribute based)
// =============================================================================

/**
 * Status styles for CSS-in-JS fallback (prefer data-attributes in CSS).
 */
export const STATUS_STYLES = {
  online: {
    bg: "bg-emerald-50 dark:bg-emerald-950/60",
    border: "border-emerald-400 dark:border-emerald-600",
    text: "text-emerald-600 dark:text-emerald-400",
    dot: "bg-emerald-500",
  },
  maintenance: {
    bg: "bg-amber-50 dark:bg-amber-950/60",
    border: "border-amber-400 dark:border-amber-500",
    text: "text-amber-600 dark:text-amber-400",
    dot: "bg-amber-500",
  },
  offline: {
    bg: "bg-red-50 dark:bg-red-950/60",
    border: "border-red-400 dark:border-red-500",
    text: "text-red-600 dark:text-red-400",
    dot: "bg-red-500",
  },
} as const;

/**
 * Get status styles by category.
 */
export function getStatusStyles(status: string): (typeof STATUS_STYLES)["online"] {
  const display = getStatusDisplay(status);
  return STATUS_STYLES[display.category];
}

// =============================================================================
// Platform Pills
// =============================================================================

export const PLATFORM = {
  /** Minimum visible pills before showing +N */
  MIN_VISIBLE: 1,
  /** Maximum pills before forcing collapse */
  MAX_VISIBLE: 4,
  /** Width estimate per pill for responsive calculation */
  PILL_WIDTH_ESTIMATE: 100,
} as const;
