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
