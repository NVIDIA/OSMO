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
 * All measurements are in rem units for accessibility (scale with user's font size).
 * At 16px base font size: 1rem = 16px.
 *
 * ## Sizing Philosophy
 *
 * - **minWidthRem**: Absolute floor. Column never goes below this.
 * - **preferredWidthRem**: Ideal width when space allows. Used for initial sizing.
 *
 * On initial load:
 * - If container >= total preferred: columns use preferred widths
 * - If container < total preferred: columns shrink proportionally toward min
 * - If container < total min: columns use min widths + horizontal scroll
 */

/**
 * Recommended minimum widths in rem units.
 * Use with TanStack Table's minSize (convert via remToPx).
 */
export const COLUMN_MIN_WIDTHS_REM = {
  /** Text that truncates with ellipsis (names, descriptions) */
  TEXT_TRUNCATE: 8.75,

  /** Short text labels (status, type) */
  TEXT_SHORT: 6,

  /** Short flag values: "true", "false", "1", "0" */
  FLAG_SHORT: 4.25,

  /** Short numbers: "128/256", "1.5K/2K" */
  NUMBER_SHORT: 5,

  /** Numbers with units: "512/1,024 Gi" */
  NUMBER_WITH_UNIT: 7.25,

  /** Numbers with progress bar */
  NUMBER_WITH_PROGRESS_BAR: 8,

  /** Timestamps: "2024-01-15 14:30" */
  TIMESTAMP: 8.75,

  /** Actions column (icon buttons) - icon */
  ACTIONS_ICON: 1,

  /** Actions column (icon buttons) - small */
  ACTIONS_SMALL: 3.125,

  /** Actions column (icon buttons) - medium */
  ACTIONS_MEDIUM: 5,

  /** Status badge column */
  STATUS_BADGE: 6,

  /** Status badge column - long text */
  STATUS_BADGE_LONG: 8,
} as const;

/**
 * Recommended preferred widths in rem units.
 * These are the "ideal" widths when container has enough space.
 * Columns won't grow beyond preferred (extra space = whitespace on right).
 */
export const COLUMN_PREFERRED_WIDTHS_REM = {
  /** Text that truncates - comfortable reading width */
  TEXT_TRUNCATE: 16,

  /** Short text labels (status, type) - badge + text */
  TEXT_SHORT: 8,

  /** Short flag values: "true", "false", "1", "0" */
  FLAG_SHORT: 4.25,

  /** Short numbers with fraction: "128/256" */
  NUMBER_SHORT: 6.5,

  /** Numbers with units: "512/1,024 Gi" */
  NUMBER_WITH_UNIT: 9,

  /** Timestamps: "2024-01-15 14:30" with breathing room */
  TIMESTAMP: 11,

  /** Actions column (icon buttons) - small */
  ACTIONS_SMALL: 3.5,

  /** Actions column (icon buttons) - medium */
  ACTIONS_MEDIUM: 5.5,

  /** Status badge column - dot + text */
  STATUS_BADGE: 10,

  /** Status badge column - long text */
  STATUS_BADGE_LONG: 12,

  /** Progress bar column - bar + percentage */
  PROGRESS_BAR: 12,

  /** Platform icons column - ~4 icons */
  PLATFORM_ICONS: 10,
} as const;

/**
 * Average character width in rem for text estimation.
 * Based on typical monospace and proportional fonts at 1rem size.
 */
export const AVG_CHAR_WIDTH_REM = 0.55;

/**
 * Cell padding in rem (px-4 = 1rem each side = 2rem total).
 */
export const CELL_PADDING_REM = 2;

/**
 * Resize handle width in pixels (fixed, doesn't scale with font).
 */
export const RESIZE_HANDLE_WIDTH_PX = 8;

/**
 * Extra buffer in pixels for visual breathing room after measurement.
 */
export const MEASUREMENT_BUFFER_PX = 16;

/**
 * Extra buffer for resize handle and breathing room (rem, used in preferred width calculations).
 */
export const CELL_BUFFER_REM = 0.5;
