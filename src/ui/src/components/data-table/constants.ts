// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION. All rights reserved.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
//
// SPDX-License-Identifier: Apache-2.0

/**
 * Data Table Constants
 *
 * Type-safe constant definitions for the DataTable component.
 * Uses `as const` pattern for:
 * - Better tree-shaking than TypeScript enums
 * - Type inference at compile time
 * - Runtime values for comparisons
 *
 * ## Best Practices
 * - Always use these constants instead of string literals
 * - Use exhaustive switch matching with `assertNever` helper
 * - TypeScript will catch any missing cases at compile time
 */

// =============================================================================
// Exhaustive Check Helper
// =============================================================================

/**
 * Helper for exhaustive switch statements.
 * TypeScript will error if any case is missing.
 *
 * @example
 * ```ts
 * function handleMode(mode: PreferenceMode): string {
 *   switch (mode) {
 *     case PreferenceModes.TRUNCATE:
 *       return "truncated";
 *     case PreferenceModes.NO_TRUNCATE:
 *       return "full";
 *     default:
 *       return assertNever(mode);
 *   }
 * }
 * ```
 */
export function assertNever(value: never): never {
  throw new Error(`Unexpected value: ${JSON.stringify(value)}`);
}

// =============================================================================
// Column Sizing Preference Mode
// =============================================================================

/**
 * User's preference for column sizing behavior.
 *
 * - TRUNCATE: User accepts truncation. Floor = persisted width.
 * - NO_TRUNCATE: User wants full content. Floor = contentWidth (measured).
 */
export const PreferenceModes = {
  /** User accepts truncation. Floor = persisted width. */
  TRUNCATE: "truncate",
  /** User wants full content. Floor = contentWidth (measured from auto-fit). */
  NO_TRUNCATE: "no-truncate",
} as const;

export type PreferenceMode = (typeof PreferenceModes)[keyof typeof PreferenceModes];

// =============================================================================
// Sort Direction
// =============================================================================

/**
 * Sort direction for table columns.
 */
export const SortDirections = {
  /** Ascending order (A-Z, 0-9) */
  ASC: "asc",
  /** Descending order (Z-A, 9-0) */
  DESC: "desc",
} as const;

export type SortDirection = (typeof SortDirections)[keyof typeof SortDirections];

// =============================================================================
// Column Width Config Types
// =============================================================================

/**
 * Types for dynamic column width calculation.
 */
export const ColumnWidthConfigTypes = {
  /** Calculate from text content length */
  TEXT: "text",
} as const;

export type ColumnWidthConfigType = (typeof ColumnWidthConfigTypes)[keyof typeof ColumnWidthConfigTypes];

// =============================================================================
// Virtual Item Types
// =============================================================================

/**
 * Types for virtualized table items.
 */
export const VirtualItemTypes = {
  /** Section header row */
  SECTION: "section",
  /** Data row */
  ROW: "row",
} as const;

export type VirtualItemType = (typeof VirtualItemTypes)[keyof typeof VirtualItemTypes];

// =============================================================================
// Text Alignment
// =============================================================================

/**
 * Text alignment options for table cells.
 */
export const TextAlignments = {
  LEFT: "left",
  RIGHT: "right",
} as const;

export type TextAlignment = (typeof TextAlignments)[keyof typeof TextAlignments];

// =============================================================================
// Element Types
// =============================================================================

/**
 * Element type options for sortable cells.
 */
export const ElementTypes = {
  TH: "th",
  DIV: "div",
} as const;

export type ElementType = (typeof ElementTypes)[keyof typeof ElementTypes];
