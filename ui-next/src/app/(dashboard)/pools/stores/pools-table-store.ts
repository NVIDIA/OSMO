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

import { createTableStore, createTableSelectors } from "@/stores";
import { create } from "zustand";
import { persist, devtools } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";

/**
 * Pool-specific extended state.
 *
 * Note: displayMode and compactMode are now in useSharedPreferences
 * for consistency across pools and resources pages.
 */
interface PoolsExtendedState {
  /** Whether the panel header info section is expanded */
  headerExpanded: boolean;
}

interface PoolsExtendedActions {
  setHeaderExpanded: (expanded: boolean) => void;
  toggleHeaderExpanded: () => void;
}

/**
 * Pools table store for column/sort/panel preferences.
 */
export const usePoolsTableStore = createTableStore({
  storageKey: "pools-table",
  defaultVisibleColumns: ["name", "description", "quota", "capacity", "platforms", "backend"],
  defaultColumnOrder: ["name", "description", "quota", "capacity", "platforms", "backend"],
  defaultSort: { column: "name", direction: "asc" },
  defaultPanelWidth: 40,
});

/**
 * Pre-bound selector hooks for the pools table store.
 *
 * Uses useShallow internally to prevent unnecessary re-renders.
 *
 * @example
 * ```tsx
 * const { visibleColumnIds, setVisibleColumns } = poolsTableSelectors.useColumnState();
 * const { sort, setSort } = poolsTableSelectors.useSorting();
 * ```
 */
export const poolsTableSelectors = createTableSelectors(usePoolsTableStore);

/**
 * Pools-specific extended state (not shared with resources).
 */
export const usePoolsExtendedStore = create<PoolsExtendedState & PoolsExtendedActions>()(
  devtools(
    persist(
      immer((set) => ({
        headerExpanded: false,
        setHeaderExpanded: (expanded) =>
          set(
            (state) => {
              state.headerExpanded = expanded;
            },
            false,
            "setHeaderExpanded",
          ),
        toggleHeaderExpanded: () =>
          set(
            (state) => {
              state.headerExpanded = !state.headerExpanded;
            },
            false,
            "toggleHeaderExpanded",
          ),
      })),
      {
        name: "pools-extended",
        partialize: (state) => ({ headerExpanded: state.headerExpanded }),
      },
    ),
    { name: "pools-extended", enabled: process.env.NODE_ENV === "development" },
  ),
);

// Re-export shared preferences for backwards compatibility
export { useSharedPreferences } from "@/stores";

export type { TableState, TableActions, TableStore, SearchChip } from "@/stores";
