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
import { WorkflowPriority, TaskGroupStatus } from "@/lib/api/generated";
import type { OccupancyGroup, OccupancyGroupBy } from "@/lib/api/adapter/occupancy";

function getGroupKeys(groups: OccupancyGroup[]): string[] {
  return groups.map((g) => g.key).slice(0, 20);
}

function getChildKeys(groups: OccupancyGroup[]): string[] {
  const keys = new Set<string>();
  for (const group of groups) {
    for (const child of group.children) keys.add(child.key);
  }
  return [...keys].sort().slice(0, 20);
}

export function getOccupancySearchFields(groupBy: OccupancyGroupBy): SearchField<OccupancyGroup>[] {
  const groupByPool = groupBy === "pool";

  return [
    {
      id: "pool",
      label: "Pool",
      hint: "pool name",
      prefix: "pool:",
      freeFormHint: "Type any pool, press Enter",
      getValues: (groups) => (groupByPool ? getGroupKeys(groups) : getChildKeys(groups)),
    },
    {
      id: "user",
      label: "User",
      hint: "user name",
      prefix: "user:",
      freeFormHint: "Type any user, press Enter",
      getValues: (groups) => (groupByPool ? getChildKeys(groups) : getGroupKeys(groups)),
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
    },
    {
      id: "status",
      label: "Status",
      hint: "RUNNING, WAITING, ...",
      prefix: "status:",
      freeFormHint: "Type a status, press Enter",
      getValues: () => Object.values(TaskGroupStatus),
      exhaustive: true,
      requiresValidValue: true,
    },
  ];
}
