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

import type { Resource } from "@/lib/api/adapter/types";

/**
 * Aggregated resource metrics across a dataset.
 *
 * Used for summary cards showing total/used capacity.
 * Computed server-side on initial load, client-side when filters change.
 */
export interface ResourceAggregates {
  gpu: { used: number; total: number };
  cpu: { used: number; total: number };
  memory: { used: number; total: number };
  storage: { used: number; total: number };
}

/**
 * Compute aggregate metrics from a list of resources.
 *
 * Performance: ~0.5ms for 10k resources (loop-based, no allocations per iteration).
 * Used by both server (SSR prefetch) and client (filter changes).
 *
 * @param resources - Array of resources to aggregate
 * @returns Aggregated totals for all metrics
 */
export function computeAggregates(resources: Resource[]): ResourceAggregates {
  let gpuUsed = 0,
    gpuTotal = 0;
  let cpuUsed = 0,
    cpuTotal = 0;
  let memUsed = 0,
    memTotal = 0;
  let storUsed = 0,
    storTotal = 0;

  for (const r of resources) {
    gpuUsed += r.gpu.used;
    gpuTotal += r.gpu.total;
    cpuUsed += r.cpu.used;
    cpuTotal += r.cpu.total;
    memUsed += r.memory.used;
    memTotal += r.memory.total;
    storUsed += r.storage.used;
    storTotal += r.storage.total;
  }

  return {
    gpu: { used: gpuUsed, total: gpuTotal },
    cpu: { used: cpuUsed, total: cpuTotal },
    memory: { used: memUsed, total: memTotal },
    storage: { used: storUsed, total: storTotal },
  };
}
