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
 * Shared types for Zustand stores.
 *
 * These types are used by the store factory and feature-specific stores.
 */

// =============================================================================
// Column Types
// =============================================================================

/**
 * User override for column sizing from manual resizing.
 *
 * When user resizes:
 * - minWidthPx = the resized width (new floor)
 * - share = calculated to achieve this width proportionally
 */
export interface ColumnOverride {
  /** New minimum width in pixels (resized width becomes the floor) */
  minWidthPx: number;
  /** Calculated share to achieve this width */
  share: number;
}

/**
 * State shape for column user overrides.
 */
export type ColumnOverrides = Record<string, ColumnOverride>;

// =============================================================================
// Search Types
// =============================================================================

/**
 * Chip variant for styling (e.g., free/used filters).
 */
export type ChipVariant = "free" | "used";

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
  /** Optional variant for styling (e.g., "free" or "used") */
  variant?: ChipVariant;
}

// =============================================================================
// Table State Types
// =============================================================================

/**
 * Base state for table stores.
 */
export interface TableState {
  // Column state
  visibleColumnIds: string[];
  columnOrder: string[];
  /** Column overrides from manual resizing (simplified: just share) */
  columnOverrides: ColumnOverrides;

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
  /** Set column override (just share) */
  setColumnOverride: (id: string, override: ColumnOverride) => void;
  /** Set all column overrides at once */
  setColumnOverrides: (overrides: ColumnOverrides) => void;
  /** Reset a single column override */
  resetColumnOverride: (id: string) => void;
  /** Reset all column overrides */
  resetAllColumnOverrides: () => void;

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
