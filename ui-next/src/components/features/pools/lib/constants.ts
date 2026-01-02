/**
 * Copyright (c) 2025-2026, NVIDIA CORPORATION. All rights reserved.
 *
 * NVIDIA CORPORATION and its licensors retain all intellectual property
 * and proprietary rights in and to this software, related documentation
 * and any modifications thereto. Any use, reproduction, disclosure or
 * distribution of this software and related documentation without an express
 * license agreement from NVIDIA CORPORATION is strictly prohibited.
 */

import { PoolStatus } from "@/lib/api/generated";

// ============================================================================
// Display Mode (Free/Used Toggle)
// ============================================================================

export type DisplayMode = "free" | "used";

/**
 * Color styles for display mode toggle and related UI elements.
 * Provides consistent theming across the pools feature.
 */
export const DISPLAY_MODE_STYLES = {
  free: {
    bg: "bg-emerald-50 dark:bg-emerald-900/30",
    text: "text-emerald-700 dark:text-emerald-400",
    textMuted: "text-emerald-600 dark:text-emerald-400",
    icon: "text-emerald-500",
    border: "border-emerald-200 dark:border-emerald-800",
  },
  used: {
    bg: "bg-amber-50 dark:bg-amber-900/30",
    text: "text-amber-700 dark:text-amber-400",
    textMuted: "text-amber-600 dark:text-amber-400",
    icon: "text-amber-500",
    border: "border-amber-200 dark:border-amber-800",
  },
} as const;

/**
 * Get display mode styles by mode
 */
export function getDisplayModeStyles(mode: DisplayMode) {
  return DISPLAY_MODE_STYLES[mode];
}

// Panel snap presets for quick width adjustments
export const PANEL = {
  WIDTH_PRESETS: [33, 50, 75] as const,
} as const;

export type StatusCategory = "online" | "maintenance" | "offline";

export interface StatusDisplay {
  category: StatusCategory;
  label: string;
  sortOrder: number;
}

const STATUS_DISPLAYS: Record<string, StatusDisplay> = {
  [PoolStatus.ONLINE]: { category: "online", label: "Online", sortOrder: 0 },
  [PoolStatus.MAINTENANCE]: { category: "maintenance", label: "Maintenance", sortOrder: 1 },
  [PoolStatus.OFFLINE]: { category: "offline", label: "Offline", sortOrder: 2 },
};

export function getStatusDisplay(status: string): StatusDisplay {
  return STATUS_DISPLAYS[status] ?? { category: "offline", label: status, sortOrder: 99 };
}

export const STATUS_ORDER = [PoolStatus.ONLINE, PoolStatus.MAINTENANCE, PoolStatus.OFFLINE];

// Tailwind classes for status styling (used in pool-panel)
export const STATUS_STYLES = {
  online: { dot: "bg-emerald-500" },
  maintenance: { dot: "bg-amber-500" },
  offline: { dot: "bg-red-500" },
} as const;

export function getStatusStyles(status: string) {
  return STATUS_STYLES[getStatusDisplay(status).category];
}
