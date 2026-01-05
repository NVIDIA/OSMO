/**
 * Copyright (c) 2025-2026, NVIDIA CORPORATION. All rights reserved.
 *
 * NVIDIA CORPORATION and its licensors retain all intellectual property
 * and proprietary rights in and to this software, related documentation
 * and any modifications thereto. Any use, reproduction, disclosure or
 * distribution of this software and related documentation without an express
 * license agreement from NVIDIA CORPORATION is strictly prohibited.
 */

/**
 * Store utilities and factories.
 *
 * This module provides generic, reusable store patterns for the dashboard.
 * Feature-specific stores should be created using these factories.
 *
 * Best Practices (for Next.js with Zustand):
 * - Use atomic selectors to minimize re-renders
 * - Use useShallow when selecting multiple properties
 * - Handle hydration with useIsHydrated or useHydratedValue
 * - Keep stores in "use client" components only
 *
 * @see https://zustand.docs.pmnd.rs/guides/nextjs
 * @see https://tkdodo.eu/blog/working-with-zustand
 *
 * Usage:
 * ```ts
 * // In feature store file
 * import { createTableStore, createTableSelectors } from "@/stores";
 *
 * export const usePoolsTableStore = createTableStore({
 *   storageKey: "pools-table",
 *   defaultVisibleColumns: ["name", "quota"],
 *   defaultColumnOrder: ["name", "quota", "capacity"],
 * });
 *
 * // Optional: Create bound selectors for this store
 * export const poolsSelectors = createTableSelectors(usePoolsTableStore);
 *
 * // In component
 * const { visibleColumnIds } = poolsSelectors.useColumnState();
 * ```
 */

// Table store factory
export { createTableStore, type CreateTableStoreOptions } from "./create-table-store";
export type {
  TableState,
  TableActions,
  TableStore,
  ColumnOverride,
  ColumnOverrides,
  SearchChip,
  ChipVariant,
} from "./types";

// Shared preferences (cross-feature)
export {
  useSharedPreferences,
  initialState as sharedPreferencesInitialState,
  type SharedPreferencesStore,
  type DisplayMode,
} from "./shared-preferences-store";

// Selector utilities (for optimal re-render behavior)
export {
  sharedPreferencesSelectors,
  tableSelectors,
  createTableSelectors,
  useDisplayMode,
  useCompactMode,
} from "./selectors";

// Hydration utilities (for SSR safety)
export {
  useIsHydrated,
  useHydratedValue,
  useStoreHydrated,
  type StoreWithPersist,
} from "./use-store-hydration";
