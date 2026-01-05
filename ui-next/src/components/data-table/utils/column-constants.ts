/**
 * Copyright (c) 2025-2026, NVIDIA CORPORATION. All rights reserved.
 *
 * NVIDIA CORPORATION and its licensors retain all intellectual property
 * and proprietary rights in and to this software, related documentation
 * and any modifications thereto. Any use, reproduction, disclosure or
 * distribution of this software and related documentation without an express
 * license agreement from NVIDIA CORPORATION is strictly prohibited.
 */

/**
 * Column sizing constants for DataTable columns.
 *
 * These values are used as defaults/references when defining column configurations.
 * All measurements are in rem units for accessibility (scale with user's font size).
 */

// =============================================================================
// Minimum Widths
// =============================================================================

/**
 * Recommended minimum widths in rem units.
 *
 * These are accessibility-friendly as they scale with user's font size.
 * Calculated at 16px base font size (1rem = 16px).
 */
export const COLUMN_MIN_WIDTHS_REM = {
  /** Text that truncates with ellipsis (names, descriptions) - 8.75rem */
  TEXT_TRUNCATE: 8.75,

  /** Short text labels (status, type) - 5rem */
  TEXT_SHORT: 5,

  /** Short numbers: "128/256", "1.5K/2K" - 5rem */
  NUMBER_SHORT: 5,

  /** Numbers with units: "512/1,024 Gi" - 7.25rem */
  NUMBER_WITH_UNIT: 7.25,

  /** Timestamps: "2024-01-15 14:30" - 8.75rem */
  TIMESTAMP: 8.75,

  /** Actions column (icon buttons) - small 3.125rem */
  ACTIONS_SMALL: 3.125,

  /** Actions column (icon buttons) - medium 5rem */
  ACTIONS_MEDIUM: 5,

  /** Status badge column - 6rem */
  STATUS_BADGE: 6,
} as const;

// =============================================================================
// Flex Values
// =============================================================================

/**
 * Recommended flex values for proportional scaling.
 */
export const COLUMN_FLEX = {
  /** Primary/main column (e.g., name) - gets most space */
  PRIMARY: 3,

  /** Secondary text columns */
  SECONDARY: 1.5,

  /** Tertiary text columns */
  TERTIARY: 1,

  /** Numeric columns with units */
  NUMERIC_WIDE: 1.4,

  /** Short numeric columns */
  NUMERIC: 1,

  /** Fixed-width columns (actions, icons) */
  FIXED: 0,
} as const;
