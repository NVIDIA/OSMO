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
 * Column Visibility Hook
 *
 * Builds a TanStack Table-compatible column visibility map from
 * column order and visible column ID arrays. Shared across all
 * DataTable wrappers to eliminate duplicated map construction.
 */

import { useMemo } from "react";

/**
 * Creates a memoized column visibility record for TanStack Table.
 *
 * Starts with all columns in `columnOrder` set to hidden, then
 * enables only those present in `visibleColumnIds`.
 *
 * @param columnOrder - All column IDs in display order
 * @param visibleColumnIds - Subset of column IDs that should be visible
 * @returns A `Record<string, boolean>` suitable for TanStack columnVisibility
 */
export function useColumnVisibility(columnOrder: string[], visibleColumnIds: string[]): Record<string, boolean> {
  return useMemo(() => {
    const visibility: Record<string, boolean> = {};
    columnOrder.forEach((id) => {
      visibility[id] = false;
    });
    visibleColumnIds.forEach((id) => {
      visibility[id] = true;
    });
    return visibility;
  }, [columnOrder, visibleColumnIds]);
}
