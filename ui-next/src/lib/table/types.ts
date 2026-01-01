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
// Search Types
// =============================================================================

/**
 * A search filter chip.
 */
export interface SearchChip {
  /** Field ID this chip filters */
  field: string;
  /** Filter value */
  value: string;
  /** Display label (what user sees) */
  label: string;
}

/**
 * Definition for a searchable field.
 */
export interface SearchField<TData> {
  /** Field ID */
  id: string;
  /** Display label */
  label: string;
  /** Prefix for typed queries (e.g., "status:") */
  prefix: string;
  /** Get available values for autocomplete */
  getValues: (data: TData[]) => string[];
  /** Check if an item matches the filter value */
  match: (item: TData, value: string) => boolean;
}

// =============================================================================
// Table State Types
// =============================================================================

/**
 * Complete table UI state.
 */
export interface TableUIState<TColumnId extends string = string> {
  /** Currently visible column IDs */
  visibleColumnIds: TColumnId[];
  /** Column order (for DND reordering) */
  columnOrder: TColumnId[];
  /** Current sort state */
  sort: SortState<TColumnId>;
  /** Whether compact mode is enabled */
  compactMode: boolean;
  /** Active search chips */
  searchChips: SearchChip[];
  /** Collapsed section IDs (for grouped tables) */
  collapsedSections: string[];
}

/**
 * Table UI actions.
 */
export interface TableUIActions<TColumnId extends string = string> {
  /** Toggle column visibility */
  toggleColumn: (id: TColumnId) => void;
  /** Set column order */
  setColumnOrder: (order: TColumnId[]) => void;
  /** Set sort (cycles through asc/desc/none) */
  setSort: (column: TColumnId) => void;
  /** Toggle compact mode */
  toggleCompactMode: () => void;
  /** Set search chips */
  setSearchChips: (chips: SearchChip[]) => void;
  /** Toggle section collapse */
  toggleSection: (id: string) => void;
}
