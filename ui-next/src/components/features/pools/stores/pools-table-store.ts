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
  selectedPoolName: string | null;
}

interface PoolsExtendedActions {
  toggleDisplayMode: () => void;
  setSelectedPool: (name: string | null) => void;
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
        selectedPoolName: null,
        toggleDisplayMode: () =>
          set((state) => { state.displayMode = state.displayMode === "free" ? "used" : "free"; }, false, "toggleDisplayMode"),
        setSelectedPool: (name) =>
          set((state) => { state.selectedPoolName = name; }, false, "setSelectedPool"),
      })),
      {
        name: "pools-extended-v1",
        // selectedPoolName excluded from persistence (ephemeral)
        partialize: (state) => ({ displayMode: state.displayMode }),
      },
    ),
    { name: "pools-extended-v1", enabled: process.env.NODE_ENV === "development" },
  ),
);

export type { TableState, TableActions, TableStore, SearchChip } from "@/lib/stores";
