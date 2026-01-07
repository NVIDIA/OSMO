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
 *
 * NOTE: Column sizing and sort types are imported from @/components/data-table
 * which is the single source of truth. Do not redefine these types here.
 */

// =============================================================================
// Re-export from Data Table (Single Source of Truth)
// =============================================================================

// Import column sizing types from data-table (single source of truth)
import type {
  ColumnSizingPreference,
  ColumnSizingPreferences,
  SortDirection,
  PreferenceMode,
} from "@/components/data-table/types";

// Re-export for consumers of this module
export type { ColumnSizingPreference, ColumnSizingPreferences, SortDirection, PreferenceMode };

// =============================================================================
// Search Types (Single Source of Truth: smart-search)
// =============================================================================

// Import search types from smart-search component (single source of truth)
import type { ChipVariant, SearchChip } from "@/components/smart-search/types";

// Re-export for consumers of this module
export type { ChipVariant, SearchChip };

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
  /** Column sizing preferences from manual resizing */
  columnSizingPreferences: ColumnSizingPreferences;

  // Sort state
  sort: { column: string; direction: SortDirection } | null;

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

  /** Set a single column's sizing preference */
  setColumnSizingPreference: (id: string, preference: ColumnSizingPreference) => void;
  /** Set multiple column sizing preferences at once */
  setColumnSizingPreferences: (preferences: ColumnSizingPreferences) => void;
  /** Remove a single column's sizing preference (reset to default) */
  removeColumnSizingPreference: (id: string) => void;

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
