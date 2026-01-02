/**
 * Copyright (c) 2026, NVIDIA CORPORATION. All rights reserved.
 *
 * NVIDIA CORPORATION and its licensors retain all intellectual property
 * and proprietary rights in and to this software, related documentation
 * and any modifications thereto. Any use, reproduction, disclosure or
 * distribution of this software and related documentation without an express
 * license agreement from NVIDIA CORPORATION is strictly prohibited.
 */

import { createTableStore } from "@/lib/stores";

/**
 * Resources table store for column/sort/panel preferences.
 *
 * Note: displayMode and compactMode are in useSharedPreferences
 * for consistency across pools and resources pages.
 */
export const useResourcesTableStore = createTableStore({
  storageKey: "resources-table-v1",
  defaultVisibleColumns: ["resource", "platform", "gpu", "cpu", "memory", "storage"],
  defaultColumnOrder: ["resource", "pools", "platform", "gpu", "cpu", "memory", "storage"],
  defaultSort: { column: "resource", direction: "asc" },
  defaultPanelWidth: 40,
});

// Re-export shared preferences for convenience
export { useSharedPreferences } from "@/lib/stores";

export type { TableState, TableActions, TableStore, SearchChip } from "@/lib/stores";
