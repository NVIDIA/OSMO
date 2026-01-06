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

import { createTableStore } from "@/stores";
import { create } from "zustand";
import { persist, devtools } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";
import { DEFAULT_VISIBLE_COLUMNS, DEFAULT_COLUMN_ORDER, DEFAULT_SORT, DEFAULT_PANEL_WIDTH } from "../lib/pool-columns";

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
 *
 * All defaults are defined in ../lib/pool-columns.ts (single source of truth).
 */
export const usePoolsTableStore = createTableStore({
  storageKey: "pools-table",
  defaultVisibleColumns: DEFAULT_VISIBLE_COLUMNS,
  defaultColumnOrder: DEFAULT_COLUMN_ORDER,
  defaultSort: DEFAULT_SORT,
  defaultPanelWidth: DEFAULT_PANEL_WIDTH,
});

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
