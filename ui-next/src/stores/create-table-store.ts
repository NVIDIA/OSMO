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

// Factory for table UI stores with persistence. skipHydration for SSR.

import { create } from "zustand";
import { persist, createJSONStorage, devtools } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";
import type {
  TableState,
  TableStore,
  SearchChip,
  ColumnSizingPreference,
  ColumnSizingPreferences,
} from "@/stores/types";

export interface CreateTableStoreOptions {
  storageKey: string;
  defaultVisibleColumns: readonly string[];
  defaultColumnOrder: readonly string[];
  defaultSort?: TableState["sort"];
  defaultPanelWidth?: number;
  /** Skip auto-hydration for SSR - call store.persist.rehydrate() after mount */
  skipHydration?: boolean;
}

export function createTableStore(options: CreateTableStoreOptions) {
  const {
    storageKey,
    defaultVisibleColumns,
    defaultColumnOrder,
    defaultSort = null,
    defaultPanelWidth = 40,
    skipHydration = false,
  } = options;

  const initialState: TableState = {
    visibleColumnIds: [...defaultVisibleColumns],
    columnOrder: [...defaultColumnOrder],
    columnSizingPreferences: {},
    sort: defaultSort,
    compactMode: false,
    collapsedSections: [],
    panelWidth: defaultPanelWidth,
    searchChips: [],
  };

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

          reset: () => set(() => initialState, false, "reset"),
        })),
        {
          name: storageKey,
          storage: createJSONStorage(() => localStorage),
          skipHydration,
          partialize: (state) => ({
            visibleColumnIds: state.visibleColumnIds,
            columnOrder: state.columnOrder,
            columnSizingPreferences: state.columnSizingPreferences,
            sort: state.sort,
            compactMode: state.compactMode,
            collapsedSections: state.collapsedSections,
            panelWidth: state.panelWidth,
          }),
          merge: (persisted, current) => {
            if (!persisted || typeof persisted !== "object") {
              return current;
            }
            const p = persisted as Partial<TableState>;
            const existingVisible = p.visibleColumnIds ?? [];
            const existingOrder = p.columnOrder ?? [];

            const newColumns = defaultColumnOrder.filter((c) => !existingOrder.includes(c));
            const newVisibleColumns = newColumns.filter((c) => defaultVisibleColumns.includes(c));

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
