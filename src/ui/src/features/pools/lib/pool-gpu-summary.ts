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

import type { Pool, Quota } from "@/lib/api/adapter/types";

/**
 * Compute GPU summary for a filtered subset of pools, correctly handling
 * shared hardware deduplication.
 *
 * - Quota fields (used/free/limit) and totalUsage: per-pool values, summed directly.
 * - totalCapacity/totalFree: per-node-set values shared across pools in a
 *   sharing group — counted once per group if any pool in the group is visible.
 */
export function computePoolGpuSummary(pools: Pool[], sharingGroups: string[][]): Quota {
  let quotaUsed = 0;
  let quotaFree = 0;
  let quotaLimit = 0;
  let totalUsage = 0;
  let totalCapacity = 0;
  let totalFree = 0;

  const countedGroupIndices = new Set<number>();

  for (const pool of pools) {
    quotaUsed += pool.quota.used;
    quotaFree += pool.quota.free;
    quotaLimit += pool.quota.limit;
    totalUsage += pool.quota.totalUsage;

    const groupIndex = sharingGroups.findIndex((g) => g.includes(pool.name));
    const isUngrouped = groupIndex === -1;
    const isFirstInGroup = !isUngrouped && !countedGroupIndices.has(groupIndex);

    if (!isUngrouped) {
      countedGroupIndices.add(groupIndex);
    }

    if (isUngrouped || isFirstInGroup) {
      totalCapacity += pool.quota.totalCapacity;
      totalFree += pool.quota.totalFree;
    }
  }

  return { used: quotaUsed, free: quotaFree, limit: quotaLimit, totalUsage, totalCapacity, totalFree };
}
