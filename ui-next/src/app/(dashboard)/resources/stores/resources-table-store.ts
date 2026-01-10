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

import { createTableStore } from "@/stores";
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

export type { TableState, TableActions, TableStore, SearchChip } from "@/stores";
