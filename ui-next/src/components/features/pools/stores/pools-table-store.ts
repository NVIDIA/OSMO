/**
 * Copyright (c) 2025, NVIDIA CORPORATION. All rights reserved.
 *
 * NVIDIA CORPORATION and its licensors retain all intellectual property
 * and proprietary rights in and to this software, related documentation
 * and any modifications thereto. Any use, reproduction, disclosure or
 * distribution of this software and related documentation without an express
 * license agreement from NVIDIA CORPORATION is strictly prohibited.
 */

/**
 * Pools Table Store
 *
 * Persists user preferences for the pools table:
 * - Column visibility and order
 * - Sort state
 * - Compact mode
 * - Collapsed sections
 * - Panel width
 * - Custom column widths
 * - Display mode (used/free toggle)
 */

import { createTableStore } from "@/lib/stores";
import { create } from "zustand";
import { persist, devtools } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";

// =============================================================================
// Extended State for Pools
// =============================================================================

interface PoolsExtendedState {
  /** Display mode for GPU numbers: "used" shows usage, "free" shows available */
  displayMode: "used" | "free";
  /** Selected pool name (for panel) */
  selectedPoolName: string | null;
}

interface PoolsExtendedActions {
  toggleDisplayMode: () => void;
  setSelectedPool: (name: string | null) => void;
}

type PoolsExtendedStore = PoolsExtendedState & PoolsExtendedActions;

// =============================================================================
// Base Table Store
// =============================================================================

/**
 * Base table store created from factory.
 * Handles column visibility, order, sort, compact mode, etc.
 */
export const usePoolsTableStore = createTableStore({
  storageKey: "pools-table-v1",
  defaultVisibleColumns: ["name", "description", "quota", "capacity", "platforms", "backend"],
  defaultColumnOrder: ["name", "description", "quota", "capacity", "platforms", "backend"],
  defaultSort: { column: "name", direction: "asc" },
  defaultPanelWidth: 40,
});

// =============================================================================
// Extended Store for Pools-Specific State
// =============================================================================

/**
 * Extended store for pools-specific state not in base table store.
 * Handles display mode and selected pool.
 */
export const usePoolsExtendedStore = create<PoolsExtendedStore>()(
  devtools(
    persist(
      immer((set) => ({
        // Initial state
        displayMode: "free" as const,
        selectedPoolName: null,

        // Actions
        toggleDisplayMode: () =>
          set(
            (state) => {
              state.displayMode = state.displayMode === "free" ? "used" : "free";
            },
            false,
            "toggleDisplayMode",
          ),

        setSelectedPool: (name) =>
          set(
            (state) => {
              state.selectedPoolName = name;
            },
            false,
            "setSelectedPool",
          ),
      })),
      {
        name: "pools-extended-v1",
        partialize: (state) => ({
          displayMode: state.displayMode,
          // selectedPoolName intentionally excluded - ephemeral
        }),
      },
    ),
    {
      name: "pools-extended-v1",
      enabled: process.env.NODE_ENV === "development",
    },
  ),
);

// =============================================================================
// Selectors
// =============================================================================

// Re-export types for convenience
export type { TableState, TableActions, TableStore, SearchChip } from "@/lib/stores";
