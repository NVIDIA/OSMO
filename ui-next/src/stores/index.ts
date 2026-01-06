/**
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION. All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * SPDX-License-Identifier: Apache-2.0
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
 * - Keep stores in "use client" components only
 *
 * @see https://zustand.docs.pmnd.rs/guides/nextjs
 * @see https://tkdodo.eu/blog/working-with-zustand
 *
 * Usage:
 * ```ts
 * // In feature store file
 * import { createTableStore } from "@/stores";
 *
 * export const usePoolsTableStore = createTableStore({
 *   storageKey: "pools-table",
 *   defaultVisibleColumns: ["name", "quota"],
 *   defaultColumnOrder: ["name", "quota", "capacity"],
 * });
 *
 * // In component
 * const visibleColumnIds = usePoolsTableStore((s) => s.visibleColumnIds);
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
