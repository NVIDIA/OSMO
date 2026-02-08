// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION. All rights reserved.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
//
// SPDX-License-Identifier: Apache-2.0

/**
 * Task Table Store
 *
 * Zustand store for the task table in group details panel.
 * Uses the canonical createTableStore factory for consistency with
 * other tables (pools, resources, workflows).
 */

import { createTableStore } from "@/stores/create-table-store";
import {
  DEFAULT_VISIBLE_COLUMNS,
  DEFAULT_COLUMN_ORDER,
  DEFAULT_SORT,
} from "@/app/(dashboard)/workflows/[name]/lib/task-columns";

/**
 * Task table store for persisting column visibility, order, and sort state.
 *
 * Features (from createTableStore):
 * - Column visibility and ordering
 * - Column sizing preferences
 * - Sort state
 * - localStorage persistence
 * - Smart merge on app updates (handles new columns)
 *
 * @example
 * ```tsx
 * const visibleColumnIds = useTaskTableStore((s) => s.visibleColumnIds);
 * const toggleColumn = useTaskTableStore((s) => s.toggleColumn);
 * const sort = useTaskTableStore((s) => s.sort);
 * const setSort = useTaskTableStore((s) => s.setSort);
 * ```
 */
export const useTaskTableStore = createTableStore({
  storageKey: "dag-task-table",
  defaultVisibleColumns: DEFAULT_VISIBLE_COLUMNS,
  defaultColumnOrder: DEFAULT_COLUMN_ORDER,
  defaultSort: DEFAULT_SORT,
});
