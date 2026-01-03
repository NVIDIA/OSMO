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

import { create, type StateCreator } from "zustand";
import { persist, createJSONStorage, devtools } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";
import type { TableState, TableActions, TableStore, SearchChip } from "./types";

// =============================================================================
// Factory Options
// =============================================================================

export interface CreateTableStoreOptions {
  /** Unique storage key for localStorage */
  storageKey: string;
  /** Default visible column IDs */
  defaultVisibleColumns: string[];
  /** Default column order */
  defaultColumnOrder: string[];
  /** Default sort (optional) */
  defaultSort?: TableState["sort"];
  /** Default panel width percentage */
  defaultPanelWidth?: number;
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
  } = options;

  // Initial state (what gets persisted)
  const initialState: TableState = {
    visibleColumnIds: defaultVisibleColumns,
    columnOrder: defaultColumnOrder,
    columnUserWidths: {},
    sort: defaultSort,
    compactMode: false,
    collapsedSections: [],
    panelWidth: defaultPanelWidth,
    searchChips: [], // Ephemeral - not persisted
  };

  // State creator with immer for immutable updates
  const stateCreator: StateCreator<
    TableStore,
    [["zustand/immer", never], ["zustand/devtools", never], ["zustand/persist", unknown]]
  > = (set) => ({
    ...initialState,

    // Column actions
    setVisibleColumns: (ids) =>
      set(
        (state) => {
          state.visibleColumnIds = ids;
        },
        false,
        "setVisibleColumns",
      ),

    toggleColumn: (id) =>
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

    setColumnOrder: (order) =>
      set(
        (state) => {
          state.columnOrder = order;
        },
        false,
        "setColumnOrder",
      ),

    setColumnWidth: (id, value, mode) =>
      set(
        (state) => {
          state.columnUserWidths[id] = { value, mode };
        },
        false,
        "setColumnWidth",
      ),

    resetColumnWidth: (id) =>
      set(
        (state) => {
          delete state.columnUserWidths[id];
        },
        false,
        "resetColumnWidth",
      ),

    resetAllColumnWidths: () =>
      set(
        (state) => {
          state.columnUserWidths = {};
        },
        false,
        "resetAllColumnWidths",
      ),

    // Sort actions
    setSort: (column) =>
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

    toggleSection: (id) =>
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

    setPanelWidth: (width) =>
      set(
        (state) => {
          state.panelWidth = width;
        },
        false,
        "setPanelWidth",
      ),

    // Search actions (ephemeral)
    setSearchChips: (chips) =>
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

    removeSearchChip: (index) =>
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

    // Reset
    reset: () => set(initialState, false, "reset"),
  });

  // Create store with middleware stack: devtools → persist → immer
  return create<TableStore>()(
    devtools(
      persist(immer(stateCreator), {
        name: storageKey,
        storage: createJSONStorage(() => localStorage),
        // Only persist these fields (exclude ephemeral state)
        partialize: (state) => ({
          visibleColumnIds: state.visibleColumnIds,
          columnOrder: state.columnOrder,
          columnUserWidths: state.columnUserWidths,
          sort: state.sort,
          compactMode: state.compactMode,
          collapsedSections: state.collapsedSections,
          panelWidth: state.panelWidth,
          // searchChips intentionally excluded - ephemeral
        }),
        // Simple passthrough for any old versioned state
        migrate: (state) => state as TableState,
        // Merge persisted state with defaults on every hydration
        // Ensures new columns are always added without versioning
        merge: (persisted, current) => {
          const p = persisted as Partial<TableState>;
          const existingVisible = p.visibleColumnIds ?? [];
          const existingOrder = p.columnOrder ?? [];
          
          // Add any missing default columns
          const missingVisible = defaultVisibleColumns.filter((c) => !existingVisible.includes(c));
          const missingOrder = defaultColumnOrder.filter((c) => !existingOrder.includes(c));
          
          return {
            ...current,
            ...p,
            visibleColumnIds: [...existingVisible, ...missingVisible],
            columnOrder: [...existingOrder, ...missingOrder],
          };
        },
      }),
      {
        name: storageKey,
        enabled: process.env.NODE_ENV === "development",
      },
    ),
  );
}
