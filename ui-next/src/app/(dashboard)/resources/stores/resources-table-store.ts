/**
 * Copyright (c) 2026, NVIDIA CORPORATION. All rights reserved.
 *
 * NVIDIA CORPORATION and its licensors retain all intellectual property
 * and proprietary rights in and to this software, related documentation
 * and any modifications thereto. Any use, reproduction, disclosure or
 * distribution of this software and related documentation without an express
 * license agreement from NVIDIA CORPORATION is strictly prohibited.
 */

import { createTableStore, createTableSelectors } from "@/stores";
import {
  DEFAULT_VISIBLE_COLUMNS,
  DEFAULT_COLUMN_ORDER,
  DEFAULT_SORT,
  DEFAULT_PANEL_WIDTH,
} from "../lib/resource-columns";

/**
 * Resources table store for column/sort/panel preferences.
 *
 * Note: displayMode and compactMode are in useSharedPreferences
 * for consistency across pools and resources pages.
 *
 * All defaults are defined in ../lib/resource-columns.ts (single source of truth).
 */
export const useResourcesTableStore = createTableStore({
  storageKey: "resources-table",
  defaultVisibleColumns: DEFAULT_VISIBLE_COLUMNS,
  defaultColumnOrder: DEFAULT_COLUMN_ORDER,
  defaultSort: DEFAULT_SORT,
  defaultPanelWidth: DEFAULT_PANEL_WIDTH,
});

/**
 * Pre-bound selector hooks for the resources table store.
 *
 * Uses useShallow internally to prevent unnecessary re-renders.
 *
 * @example
 * ```tsx
 * const { visibleColumnIds, setVisibleColumns } = resourcesTableSelectors.useColumnState();
 * const { sort, setSort } = resourcesTableSelectors.useSorting();
 * ```
 */
export const resourcesTableSelectors = createTableSelectors(useResourcesTableStore);

// Re-export shared preferences for convenience
export { useSharedPreferences } from "@/stores";

export type { TableState, TableActions, TableStore, SearchChip } from "@/stores";
