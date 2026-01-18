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
 * Generic table store factory.
 *
 * Creates Zustand stores for table UIs with:
 * - Column visibility, ordering, and resizing
 * - Sort state
 * - Compact mode
 * - Collapsible sections
 * - Panel width
 * - Search chips (ephemeral)
 * - localStorage persistence
 * - Immer for immutable updates
 *
 * Usage:
 * ```ts
 * // Create store instance
 * export const usePoolsTableStore = createTableStore({
 *   storageKey: "pools-table",
 *   defaultVisibleColumns: ["name", "quota", "capacity"],
 *   defaultColumnOrder: ["name", "quota", "capacity", "platforms"],
 *   defaultSort: { column: "name", direction: "asc" },
 * });
 *
 * // Use in component
 * const { visibleColumnIds, setSort } = usePoolsTableStore();
 * ```
 */

import { create } from "zustand";
import { persist, createJSONStorage, devtools } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";
import type { TableState, TableStore, SearchChip, ColumnSizingPreference, ColumnSizingPreferences } from "./types";

// =============================================================================
// Factory Options
// =============================================================================

export interface CreateTableStoreOptions {
  /** Unique storage key for localStorage */
  storageKey: string;
  /** Default visible column IDs */
  defaultVisibleColumns: readonly string[];
  /** Default column order */
  defaultColumnOrder: readonly string[];
  /** Default sort (optional) */
  defaultSort?: TableState["sort"];
  /** Default panel width percentage */
  defaultPanelWidth?: number;
  /**
   * Skip automatic hydration from localStorage.
   *
   * When true, the store won't hydrate automatically. You must manually
   * call `store.persist.rehydrate()` after mount. This prevents hydration
   * mismatches in SSR environments like Next.js.
   *
   * @default false
   * @see https://zustand.docs.pmnd.rs/guides/nextjs
   */
  skipHydration?: boolean;
}

// =============================================================================
// Factory Function
// =============================================================================

export function createTableStore(options: CreateTableStoreOptions) {
  const {
    storageKey,
    defaultVisibleColumns,
    defaultColumnOrder,
    defaultSort = null,
    defaultPanelWidth = 40,
    skipHydration = false,
  } = options;

  // Initial state (what gets persisted)
  const initialState: TableState = {
    visibleColumnIds: [...defaultVisibleColumns],
    columnOrder: [...defaultColumnOrder],
    columnSizingPreferences: {},
    sort: defaultSort,
    compactMode: false,
    collapsedSections: [],
    panelWidth: defaultPanelWidth,
    searchChips: [], // Ephemeral - not persisted
  };

  // Create store with middleware stack: devtools → persist → immer
  return create<TableStore>()(
    devtools(
      persist(
        immer((set) => ({
          ...initialState,

          // Column actions
          setVisibleColumns: (ids: string[]) =>
            set(
              (state) => {
                state.visibleColumnIds = ids;
              },
              false,
              "setVisibleColumns",
            ),

          toggleColumn: (id: string) =>
            set(
              (state) => {
                const idx = state.visibleColumnIds.indexOf(id);
                if (idx === -1) {
                  state.visibleColumnIds.push(id);
                } else {
                  state.visibleColumnIds.splice(idx, 1);
                }
              },
              false,
              "toggleColumn",
            ),

          setColumnOrder: (order: string[]) =>
            set(
              (state) => {
                state.columnOrder = order;
              },
              false,
              "setColumnOrder",
            ),

          // Column sizing preference actions
          setColumnSizingPreference: (id: string, preference: ColumnSizingPreference) =>
            set(
              (state) => {
                state.columnSizingPreferences[id] = preference;
              },
              false,
              "setColumnSizingPreference",
            ),

          setColumnSizingPreferences: (preferences: ColumnSizingPreferences) =>
            set(
              (state) => {
                state.columnSizingPreferences = preferences;
              },
              false,
              "setColumnSizingPreferences",
            ),

          removeColumnSizingPreference: (id: string) =>
            set(
              (state) => {
                delete state.columnSizingPreferences[id];
              },
              false,
              "removeColumnSizingPreference",
            ),

          // Sort actions
          setSort: (column: string) =>
            set(
              (state) => {
                if (state.sort?.column === column) {
                  // Toggle direction
                  state.sort.direction = state.sort.direction === "asc" ? "desc" : "asc";
                } else {
                  state.sort = { column, direction: "asc" };
                }
              },
              false,
              "setSort",
            ),

          clearSort: () =>
            set(
              (state) => {
                state.sort = null;
              },
              false,
              "clearSort",
            ),

          // UI actions
          toggleCompactMode: () =>
            set(
              (state) => {
                state.compactMode = !state.compactMode;
              },
              false,
              "toggleCompactMode",
            ),

          toggleSection: (id: string) =>
            set(
              (state) => {
                const idx = state.collapsedSections.indexOf(id);
                if (idx === -1) {
                  state.collapsedSections.push(id);
                } else {
                  state.collapsedSections.splice(idx, 1);
                }
              },
              false,
              "toggleSection",
            ),

          setPanelWidth: (width: number) =>
            set(
              (state) => {
                state.panelWidth = width;
              },
              false,
              "setPanelWidth",
            ),

          // Search actions (ephemeral)
          setSearchChips: (chips: SearchChip[]) =>
            set(
              (state) => {
                state.searchChips = chips;
              },
              false,
              "setSearchChips",
            ),

          addSearchChip: (chip: SearchChip) =>
            set(
              (state) => {
                state.searchChips.push(chip);
              },
              false,
              "addSearchChip",
            ),

          removeSearchChip: (index: number) =>
            set(
              (state) => {
                state.searchChips.splice(index, 1);
              },
              false,
              "removeSearchChip",
            ),

          clearSearch: () =>
            set(
              (state) => {
                state.searchChips = [];
              },
              false,
              "clearSearch",
            ),

          // Reset - returns full initial state
          reset: () => set(() => initialState, false, "reset"),
        })),
        {
          name: storageKey,
          storage: createJSONStorage(() => localStorage),
          skipHydration,
          // Only persist these fields (exclude ephemeral state)
          partialize: (state) => ({
            visibleColumnIds: state.visibleColumnIds,
            columnOrder: state.columnOrder,
            columnSizingPreferences: state.columnSizingPreferences,
            sort: state.sort,
            compactMode: state.compactMode,
            collapsedSections: state.collapsedSections,
            panelWidth: state.panelWidth,
            // searchChips intentionally excluded - ephemeral
          }),
          // Merge persisted state with defaults on every hydration
          merge: (persisted, current) => {
            // Handle undefined/invalid persisted state (persisted is typed as unknown by Zustand)
            if (!persisted || typeof persisted !== "object") {
              return current;
            }
            // Safe to narrow after validation - we know it's an object from localStorage
            const p = persisted as Partial<TableState>;
            const existingVisible = p.visibleColumnIds ?? [];
            const existingOrder = p.columnOrder ?? [];

            // Only add columns that are TRULY NEW (not in the persisted column order)
            const newColumns = defaultColumnOrder.filter((c) => !existingOrder.includes(c));

            // Add new columns to visible if they're default-visible
            const newVisibleColumns = newColumns.filter((c) => defaultVisibleColumns.includes(c));

            // Ensure columnSizingPreferences is always an object
            const columnSizingPreferences =
              p.columnSizingPreferences && typeof p.columnSizingPreferences === "object"
                ? p.columnSizingPreferences
                : {};

            return {
              ...current,
              ...p,
              visibleColumnIds: [...existingVisible, ...newVisibleColumns],
              columnOrder: [...existingOrder, ...newColumns],
              columnSizingPreferences,
              collapsedSections: Array.isArray(p.collapsedSections) ? p.collapsedSections : [],
              searchChips: [], // Always reset ephemeral state
            };
          },
        },
      ),
      {
        name: storageKey,
        enabled: process.env.NODE_ENV === "development",
      },
    ),
  );
}
