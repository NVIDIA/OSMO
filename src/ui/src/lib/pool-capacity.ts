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

import type { Quota } from "@/lib/api/adapter/types";

export interface PhysicalCapacity {
  used: number;
  free: number;
  total: number;
}

/**
 * Normalize physical GPU capacity across the node set backing a pool.
 *
 * totalUsage is intentionally not used here: it only counts workflows assigned
 * to one pool, while totalCapacity and totalFree cover the shared node set.
 */
export function normalizePhysicalCapacity(quota: Pick<Quota, "totalCapacity" | "totalFree">): PhysicalCapacity {
  const total = Math.max(0, quota.totalCapacity);
  const free = Math.min(total, Math.max(0, quota.totalFree));
  return { used: total - free, free, total };
}
