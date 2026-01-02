/**
 * Copyright (c) 2025, NVIDIA CORPORATION. All rights reserved.
 *
 * NVIDIA CORPORATION and its licensors retain all intellectual property
 * and proprietary rights in and to this software, related documentation
 * and any modifications thereto. Any use, reproduction, disclosure or
 * distribution of this software and related documentation without an express
 * license agreement from NVIDIA CORPORATION is strictly prohibited.
 */

import { createTableStore } from "@/lib/stores";
import { create } from "zustand";
import { persist, devtools } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";

interface PoolsExtendedState {
  displayMode: "used" | "free";
  headerExpanded: boolean;
}

interface PoolsExtendedActions {
  toggleDisplayMode: () => void;
  setHeaderExpanded: (expanded: boolean) => void;
  toggleHeaderExpanded: () => void;
}

export const usePoolsTableStore = createTableStore({
  storageKey: "pools-table-v1",
  defaultVisibleColumns: ["name", "description", "quota", "capacity", "platforms", "backend"],
  defaultColumnOrder: ["name", "description", "quota", "capacity", "platforms", "backend"],
  defaultSort: { column: "name", direction: "asc" },
  defaultPanelWidth: 40,
});

export const usePoolsExtendedStore = create<PoolsExtendedState & PoolsExtendedActions>()(
  devtools(
    persist(
      immer((set) => ({
        displayMode: "free" as const,
        headerExpanded: false,
        toggleDisplayMode: () =>
          set((state) => { state.displayMode = state.displayMode === "free" ? "used" : "free"; }, false, "toggleDisplayMode"),
        setHeaderExpanded: (expanded) =>
          set((state) => { state.headerExpanded = expanded; }, false, "setHeaderExpanded"),
        toggleHeaderExpanded: () =>
          set((state) => { state.headerExpanded = !state.headerExpanded; }, false, "toggleHeaderExpanded"),
      })),
      {
        name: "pools-extended-v1",
        partialize: (state) => ({ displayMode: state.displayMode, headerExpanded: state.headerExpanded }),
      },
    ),
    { name: "pools-extended-v1", enabled: process.env.NODE_ENV === "development" },
  ),
);

export type { TableState, TableActions, TableStore, SearchChip } from "@/lib/stores";
