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
 * Store utilities and factories.
 *
 * This module provides generic, reusable store patterns for the dashboard.
 * Feature-specific stores should be created using these factories.
 *
 * Usage:
 * ```ts
 * // In feature store file
 * import { createTableStore } from "@/lib/stores";
 *
 * export const usePoolsTableStore = createTableStore({
 *   storageKey: "pools-table-v1",
 *   defaultVisibleColumns: ["name", "quota"],
 *   defaultColumnOrder: ["name", "quota", "capacity"],
 * });
 * ```
 */

export { createTableStore, type CreateTableStoreOptions } from "./create-table-store";
export type {
  TableState,
  TableActions,
  TableStore,
  ColumnUserWidth,
  ColumnUserWidths,
  SearchChip,
} from "./types";
