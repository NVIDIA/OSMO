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
 * Core filtering logic for SmartSearch chips.
 *
 * This is pure business logic - no UI, no React, just data transformation.
 * Could be used on server-side or in workers.
 */

import type { SearchChip, SearchField } from "./types";

/**
 * Filter items by chips.
 * Same-field chips are OR'd, different-field chips are AND'd.
 *
 * @param items - Items to filter
 * @param chips - Active filter chips
 * @param fields - Field definitions with match functions
 * @returns Filtered items
 *
 * @example
 * ```ts
 * // Filter pools by status OR platform AND backend
 * const filtered = filterByChips(pools, [
 *   { field: "status", value: "ONLINE", label: "Status: ONLINE" },
 *   { field: "status", value: "MAINTENANCE", label: "Status: MAINTENANCE" },
 *   { field: "backend", value: "k8s", label: "Backend: k8s" },
 * ], poolFields);
 * // Returns pools that are (ONLINE OR MAINTENANCE) AND backend=k8s
 * ```
 */
export function filterByChips<T>(items: T[], chips: SearchChip[], fields: readonly SearchField<T>[]): T[] {
  if (chips.length === 0) return items;

  // Group chips by field for OR logic within same field
  const chipGroups = new Map<string, string[]>();
  for (const chip of chips) {
    const values = chipGroups.get(chip.field) ?? [];
    values.push(chip.value);
    chipGroups.set(chip.field, values);
  }

  return items.filter((item) => {
    // AND across different fields
    for (const [fieldId, values] of chipGroups) {
      const field = fields.find((f) => f.id === fieldId);
      // Skip fields without match function (server-side filtering)
      if (!field?.match) continue;
      // OR within same field - capture match function for type safety
      const matchFn = field.match;
      if (!values.some((v) => matchFn(item, v))) return false;
    }
    return true;
  });
}
