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
  /** Text that truncates with ellipsis (names, descriptions) */
  TEXT_TRUNCATE: 8.75,

  /** Short text labels (status, type) */
  TEXT_SHORT: 6,

  /** Short numbers: "128/256", "1.5K/2K" */
  NUMBER_SHORT: 5,

  /** Numbers with units: "512/1,024 Gi" */
  NUMBER_WITH_UNIT: 7.25,

  /** Timestamps: "2024-01-15 14:30" */
  TIMESTAMP: 8.75,

  /** Actions column (icon buttons) - small */
  ACTIONS_SMALL: 3.125,

  /** Actions column (icon buttons) - medium */
  ACTIONS_MEDIUM: 5,

  /** Status badge column */
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
