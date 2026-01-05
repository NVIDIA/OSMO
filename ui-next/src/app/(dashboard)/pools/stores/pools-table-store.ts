/**
 * Copyright (c) 2025-2026, NVIDIA CORPORATION. All rights reserved.
 *
 * NVIDIA CORPORATION and its licensors retain all intellectual property
 * and proprietary rights in and to this software, related documentation
 * and any modifications thereto. Any use, reproduction, disclosure or
 * distribution of this software and related documentation without an express
 * license agreement from NVIDIA CORPORATION is strictly prohibited.
 */

import { createTableStore } from "@/stores";
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
