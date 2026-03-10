//SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION. All rights reserved.

//Licensed under the Apache License, Version 2.0 (the "License");
//you may not use this file except in compliance with the License.
//You may obtain a copy of the License at

//http://www.apache.org/licenses/LICENSE-2.0

//Unless required by applicable law or agreed to in writing, software
//distributed under the License is distributed on an "AS IS" BASIS,
//WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//See the License for the specific language governing permissions and
//limitations under the License.

//SPDX-License-Identifier: Apache-2.0

import type { SearchField } from "@/components/filter-bar/lib/types";
import { WorkflowPriority } from "@/lib/api/generated";
import type { OccupancyGroup } from "@/lib/api/adapter/occupancy";

/**
 * FilterBar search field definitions for the occupancy page.
 *
 * Filtering is applied as API params (users/pools/priorities) so results
 * reflect server-side filtering. The FilterBar chips map to API query params
 * in use-occupancy-data.ts.
 *
 * Note: These search fields are used for autocomplete suggestions only.
 * The actual filtering happens via the API query params in the data hook.
 */
export const OCCUPANCY_SEARCH_FIELDS: SearchField<OccupancyGroup>[] = [
  {
    id: "user",
    label: "User",
    hint: "user name",
    prefix: "user:",
    freeFormHint: "Type any user, press Enter",
    getValues: (groups) => groups.map((g) => g.key).slice(0, 20),
    match: (group, value) => group.key.toLowerCase().includes(value.toLowerCase()),
  },
  {
    id: "pool",
    label: "Pool",
    hint: "pool name",
    prefix: "pool:",
    freeFormHint: "Type any pool, press Enter",
    getValues: (groups) => {
      const pools = new Set<string>();
      for (const group of groups) {
        for (const child of group.children) pools.add(child.key);
      }
      return [...pools].sort().slice(0, 20);
    },
    match: () => true, // Filtering handled server-side
  },
  {
    id: "priority",
    label: "Priority",
    hint: "HIGH, NORMAL, or LOW",
    prefix: "priority:",
    freeFormHint: "Type a priority, press Enter",
    getValues: () => [WorkflowPriority.HIGH, WorkflowPriority.NORMAL, WorkflowPriority.LOW],
    exhaustive: true,
    requiresValidValue: true,
    match: () => true, // Filtering handled server-side
  },
];
