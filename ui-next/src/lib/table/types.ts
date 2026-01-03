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
 * Generic Table Types
 *
 * Type definitions for virtualized, sortable tables with:
 * - Flexible column widths (CSS Grid minmax)
 * - Drag-and-drop column reordering
 * - Column visibility toggle
 * - Sort state
 *
 * Pattern borrowed from workflow-explorer's GroupPanel.
 */

// =============================================================================
// Column Types
// =============================================================================

/**
 * Column width specification.
 * - number: fixed width in rem (no grow/shrink)
 * - { min, share }: flexible with min floor (rem), share controls grow/shrink proportion
 * - { fit, share }: content-sized minimum (max-content), share controls grow/shrink proportion
 */
export type ColumnWidth =
  | number
  | { min: number; share: number }
  | { fit: true; share: number };

/**
 * Base column definition.
 */
export interface ColumnDef<TColumnId extends string = string> {
  /** Unique column identifier */
  id: TColumnId;
  /** Short label for table header */
  label: string;
  /** Full label for dropdown menu */
  menuLabel: string;
  /** Width specification */
  width: ColumnWidth;
  /** Column alignment */
  align: "left" | "right";
  /** Is this column sortable? */
  sortable: boolean;
}

/**
 * Optional column that can be hidden.
 */
export interface OptionalColumnDef<TColumnId extends string = string> extends ColumnDef<TColumnId> {
  /** Whether visible by default */
  defaultVisible: boolean;
}

// =============================================================================
// Sort Types
// =============================================================================

export type SortDirection = "asc" | "desc";

export interface SortState<TColumnId extends string = string> {
  column: TColumnId | null;
  direction: SortDirection;
}

// =============================================================================
// Re-exports from canonical locations
// =============================================================================

// SearchChip: use @/stores
// SearchField: use @/components/smart-search
