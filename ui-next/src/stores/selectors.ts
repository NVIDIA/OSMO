/**
 * Copyright (c) 2026, NVIDIA CORPORATION. All rights reserved.
 *
 * NVIDIA CORPORATION and its licensors retain all intellectual property
 * and proprietary rights in and to this software, related documentation
 * and any modifications thereto. Any use, reproduction, disclosure or
 * distribution of this software and related documentation without an express
 * license agreement from NVIDIA CORPORATION is strictly prohibited.
 */

/**
 * Zustand selector utilities and patterns.
 *
 * This module provides type-safe, reusable selectors for Zustand stores
 * following best practices from:
 * - https://tkdodo.eu/blog/working-with-zustand
 * - https://zustand.docs.pmnd.rs/guides/prevent-rerenders-with-use-shallow
 *
 * Key principles:
 * 1. Atomic selectors: Select only what you need
 * 2. Use useShallow: When selecting objects/arrays to prevent unnecessary re-renders
 * 3. Custom hooks: Encapsulate selector logic for better reusability
 * 4. Stable references: Keep selectors outside components or memoize them
 */

import { useShallow } from "zustand/shallow";
import type { TableStore, TableState } from "./types";
import { useSharedPreferences, type SharedPreferencesStore } from "./shared-preferences-store";

// =============================================================================
// Shared Preferences Selectors
// =============================================================================

/**
 * Atomic selectors for shared preferences.
 *
 * These can be used directly with useSharedPreferences for optimal re-render behavior.
 * Since these select single primitive values, useShallow is not needed.
 */
export const sharedPreferencesSelectors = {
  displayMode: (state: SharedPreferencesStore) => state.displayMode,
  compactMode: (state: SharedPreferencesStore) => state.compactMode,
  toggleDisplayMode: (state: SharedPreferencesStore) => state.toggleDisplayMode,
  setDisplayMode: (state: SharedPreferencesStore) => state.setDisplayMode,
  toggleCompactMode: (state: SharedPreferencesStore) => state.toggleCompactMode,
  setCompactMode: (state: SharedPreferencesStore) => state.setCompactMode,
} as const;

/**
 * Selector for display mode state and actions together.
 * Defined outside component for stable reference.
 */
const displayModeSelector = (state: SharedPreferencesStore) => ({
  displayMode: state.displayMode,
  toggleDisplayMode: state.toggleDisplayMode,
  setDisplayMode: state.setDisplayMode,
});

/**
 * Hook to get display mode state and actions together.
 *
 * Uses useShallow to prevent re-renders when other parts of the store change.
 */
export function useDisplayMode() {
  return useSharedPreferences(useShallow(displayModeSelector));
}

/**
 * Selector for compact mode state and actions together.
 * Defined outside component for stable reference.
 */
const compactModeSelector = (state: SharedPreferencesStore) => ({
  compactMode: state.compactMode,
  toggleCompactMode: state.toggleCompactMode,
  setCompactMode: state.setCompactMode,
});

/**
 * Hook to get compact mode state and actions together.
 *
 * Uses useShallow to prevent re-renders when other parts of the store change.
 */
export function useCompactMode() {
  return useSharedPreferences(useShallow(compactModeSelector));
}

// =============================================================================
// Table Store Selectors
// =============================================================================

/**
 * Atomic selectors for table stores.
 *
 * Use these with any table store created by createTableStore.
 * For single primitive values, use directly without useShallow.
 * For objects/arrays, wrap with useShallow.
 */
export const tableSelectors = {
  // Column state (arrays - use with useShallow)
  visibleColumnIds: (state: TableState) => state.visibleColumnIds,
  columnOrder: (state: TableState) => state.columnOrder,
  columnOverrides: (state: TableState) => state.columnOverrides,

  // Sort state (object - use with useShallow)
  sort: (state: TableState) => state.sort,

  // UI state (primitives - no useShallow needed)
  compactMode: (state: TableState) => state.compactMode,
  panelWidth: (state: TableState) => state.panelWidth,

  // Arrays (use with useShallow)
  collapsedSections: (state: TableState) => state.collapsedSections,
  searchChips: (state: TableState) => state.searchChips,
} as const;

/**
 * Creates a bound selector hook for a table store.
 *
 * This is useful for creating feature-specific hooks that encapsulate
 * table store access patterns.
 *
 * @param useStore - A table store hook created by createTableStore
 * @returns An object with pre-bound selector hooks
 *
 * @example
 * ```tsx
 * // In your feature store file
 * export const usePoolsTableStore = createTableStore({ ... });
 * export const poolsTableSelectors = createTableSelectors(usePoolsTableStore);
 *
 * // In your component
 * function MyComponent() {
 *   const { visibleColumnIds, setVisibleColumns } = poolsTableSelectors.useColumnState();
 * }
 * ```
 */
/**
 * Creates a bound selector hook for a table store.
 *
 * This is useful for creating feature-specific hooks that encapsulate
 * table store access patterns.
 *
 * IMPORTANT: These hooks are factory functions that create selectors.
 * The selectors are stable (defined outside the hook) to prevent
 * unnecessary re-renders.
 *
 * @param useStore - A table store hook created by createTableStore
 * @returns An object with pre-bound selector hooks
 *
 * @example
 * ```tsx
 * // In your feature store file
 * export const usePoolsTableStore = createTableStore({ ... });
 * export const poolsTableSelectors = createTableSelectors(usePoolsTableStore);
 *
 * // In your component
 * function MyComponent() {
 *   const { visibleColumnIds, setVisibleColumns } = poolsTableSelectors.useColumnState();
 * }
 * ```
 */
export function createTableSelectors<T extends TableStore>(
  useStore: {
    (): T;
    <U>(selector: (state: T) => U): U;
  },
) {
  // Define stable selectors outside the hooks
  const columnStateSelector = (state: T) => ({
    visibleColumnIds: state.visibleColumnIds,
    columnOrder: state.columnOrder,
    setVisibleColumns: state.setVisibleColumns,
    toggleColumn: state.toggleColumn,
    setColumnOrder: state.setColumnOrder,
  });

  const columnSizingSelector = (state: T) => ({
    columnOverrides: state.columnOverrides,
    setColumnOverride: state.setColumnOverride,
    setColumnOverrides: state.setColumnOverrides,
    resetColumnOverride: state.resetColumnOverride,
    resetAllColumnOverrides: state.resetAllColumnOverrides,
  });

  const sortingSelector = (state: T) => ({
    sort: state.sort,
    setSort: state.setSort,
    clearSort: state.clearSort,
  });

  const searchSelector = (state: T) => ({
    searchChips: state.searchChips,
    setSearchChips: state.setSearchChips,
    addSearchChip: state.addSearchChip,
    removeSearchChip: state.removeSearchChip,
    clearSearch: state.clearSearch,
  });

  const panelWidthSelector = (state: T) => ({
    panelWidth: state.panelWidth,
    setPanelWidth: state.setPanelWidth,
  });

  return {
    /**
     * Get column visibility and order state with actions.
     * Uses useShallow for the arrays.
     */
    useColumnState: () => useStore(useShallow(columnStateSelector)),

    /**
     * Get column sizing overrides with actions.
     * Uses useShallow for the record object.
     */
    useColumnSizing: () => useStore(useShallow(columnSizingSelector)),

    /**
     * Get sort state with actions.
     * Uses useShallow for the sort object.
     */
    useSorting: () => useStore(useShallow(sortingSelector)),

    /**
     * Get search chips state with actions.
     * Uses useShallow for the chips array.
     */
    useSearch: () => useStore(useShallow(searchSelector)),

    /**
     * Get panel width state with setter.
     */
    usePanelWidth: () => useStore(useShallow(panelWidthSelector)),
  };
}
