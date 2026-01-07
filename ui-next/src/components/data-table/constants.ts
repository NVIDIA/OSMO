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
 * - NO_TRUNCATE: User wants full content. Floor = preferred width.
 */
export const PreferenceModes = {
  /** User accepts truncation. Floor = persisted width. */
  TRUNCATE: "truncate",
  /** User wants full content. Floor = preferred width. */
  NO_TRUNCATE: "no-truncate",
} as const;

export type PreferenceMode = (typeof PreferenceModes)[keyof typeof PreferenceModes];

/** All valid preference modes for iteration/validation */
export const PREFERENCE_MODE_VALUES = Object.values(PreferenceModes);

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

/** All valid sort directions for iteration/validation */
export const SORT_DIRECTION_VALUES = Object.values(SortDirections);

// =============================================================================
// Sizing State Machine Modes
// =============================================================================

/**
 * State machine modes for column sizing.
 *
 * - IDLE: No active user interaction
 * - RESIZING: User is actively dragging a resize handle
 */
export const SizingModes = {
  /** No active user interaction */
  IDLE: "IDLE",
  /** User is actively dragging a resize handle */
  RESIZING: "RESIZING",
} as const;

export type SizingMode = (typeof SizingModes)[keyof typeof SizingModes];

/** All valid sizing modes for iteration/validation */
export const SIZING_MODE_VALUES = Object.values(SizingModes);

// =============================================================================
// Sizing State Machine Events
// =============================================================================

/**
 * State machine events for column sizing.
 */
export const SizingEventTypes = {
  /** Initial sizing calculation */
  INIT: "INIT",
  /** Container width changed */
  CONTAINER_RESIZE: "CONTAINER_RESIZE",
  /** User started dragging */
  RESIZE_START: "RESIZE_START",
  /** User is dragging */
  RESIZE_MOVE: "RESIZE_MOVE",
  /** User finished dragging */
  RESIZE_END: "RESIZE_END",
  /** Double-click to fit content */
  AUTO_FIT: "AUTO_FIT",
  /** Programmatic size change */
  SET_SIZE: "SET_SIZE",
  /** TanStack sizing state changed */
  TANSTACK_SIZING_CHANGE: "TANSTACK_SIZING_CHANGE",
  /** TanStack sizing info changed */
  TANSTACK_INFO_CHANGE: "TANSTACK_INFO_CHANGE",
} as const;

export type SizingEventType = (typeof SizingEventTypes)[keyof typeof SizingEventTypes];

/** All valid sizing event types for iteration/validation */
export const SIZING_EVENT_TYPE_VALUES = Object.values(SizingEventTypes);

// =============================================================================
// Debug Event Types
// =============================================================================

/**
 * Event types for debug logging.
 * Includes state machine events plus internal/utility events.
 */
export const DebugEventTypes = {
  ...SizingEventTypes,
  /** Cache computation timing */
  CACHE_COMPUTE: "CACHE_COMPUTE",
  /** Error occurred */
  ERROR: "ERROR",
} as const;

export type DebugEventType = (typeof DebugEventTypes)[keyof typeof DebugEventTypes];

/** All valid debug event types for iteration/validation */
export const DEBUG_EVENT_TYPE_VALUES = Object.values(DebugEventTypes);

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

/** All valid column width config types for iteration/validation */
export const COLUMN_WIDTH_CONFIG_TYPE_VALUES = Object.values(ColumnWidthConfigTypes);

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

/** All valid virtual item types for iteration/validation */
export const VIRTUAL_ITEM_TYPE_VALUES = Object.values(VirtualItemTypes);

// =============================================================================
// Scroll Alignment
// =============================================================================

/**
 * Scroll alignment options for virtualizer.
 */
export const ScrollAlignments = {
  START: "start",
  END: "end",
  CENTER: "center",
} as const;

export type ScrollAlignment = (typeof ScrollAlignments)[keyof typeof ScrollAlignments];

/** All valid scroll alignments for iteration/validation */
export const SCROLL_ALIGNMENT_VALUES = Object.values(ScrollAlignments);

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

/** All valid text alignments for iteration/validation */
export const TEXT_ALIGNMENT_VALUES = Object.values(TextAlignments);

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

/** All valid element types for iteration/validation */
export const ELEMENT_TYPE_VALUES = Object.values(ElementTypes);
