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
 * Shared types for Zustand stores.
 *
 * These types are used by the store factory and feature-specific stores.
 */

// =============================================================================
// Column Types
// =============================================================================

/**
 * User override for column width from manual resize.
 */
export interface ColumnUserWidth {
  /** The width user dragged to */
  value: number;
  /**
   * How to interpret the width:
   * - 'min': New floor, share preserved (column grew)
   * - 'fixed': Exact pixel width, no share growth (column shrunk)
   */
  mode: "min" | "fixed";
}

/**
 * State shape for column user widths.
 * Key: column ID, Value: user override
 */
export type ColumnUserWidths = Record<string, ColumnUserWidth>;

// =============================================================================
// Search Types
// =============================================================================

/**
 * A search filter chip displayed in the search bar.
 */
export interface SearchChip {
  /** Field ID this chip filters on (e.g., "status", "platform") */
  field: string;
  /** The filter value (e.g., "ONLINE", "dgx") */
  value: string;
  /** Display label (e.g., "Status: ONLINE") */
  label: string;
}

// =============================================================================
// Table State Types
// =============================================================================

/**
 * Base state for table stores.
 * This is the shape of persisted data.
 */
export interface TableState {
  // Column state
  visibleColumnIds: string[];
  columnOrder: string[];
  columnUserWidths: ColumnUserWidths;

  // Sort state
  sort: { column: string; direction: "asc" | "desc" } | null;

  // UI state
  compactMode: boolean;
  collapsedSections: string[];
  panelWidth: number;

  // Search state (ephemeral - not persisted)
  searchChips: SearchChip[];
}

/**
 * Actions for table stores.
 */
export interface TableActions {
  // Column actions
  setVisibleColumns: (ids: string[]) => void;
  toggleColumn: (id: string) => void;
  setColumnOrder: (order: string[]) => void;
  setColumnWidth: (id: string, value: number, mode: "min" | "fixed") => void;
  resetColumnWidth: (id: string) => void;
  resetAllColumnWidths: () => void;

  // Sort actions
  setSort: (column: string) => void;
  clearSort: () => void;

  // UI actions
  toggleCompactMode: () => void;
  toggleSection: (id: string) => void;
  setPanelWidth: (width: number) => void;

  // Search actions
  setSearchChips: (chips: SearchChip[]) => void;
  addSearchChip: (chip: SearchChip) => void;
  removeSearchChip: (index: number) => void;
  clearSearch: () => void;

  // Reset
  reset: () => void;
}

/**
 * Combined table store type.
 */
export type TableStore = TableState & TableActions;
