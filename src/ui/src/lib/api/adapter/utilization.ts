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

import type { ListTaskEntry } from "@/lib/api/generated";

const MS_PER_HOUR = 3_600_000;

/** Snap a timestamp up to the next full hour (no-op if already on the hour). */
export function ceilToHour(ms: number): number {
  return Math.ceil(ms / MS_PER_HOUR) * MS_PER_HOUR;
}

/** Snap a timestamp down to the previous full hour (no-op if already on the hour). */
export function floorToHour(ms: number): number {
  return Math.floor(ms / MS_PER_HOUR) * MS_PER_HOUR;
}

export type FetchTier = "1d" | "3d" | "7d" | "14d" | "30d";

export const TIER_MS: Record<FetchTier, number> = {
  "1d": 86_400_000,
  "3d": 259_200_000,
  "7d": 604_800_000,
  "14d": 1_209_600_000,
  "30d": 2_592_000_000,
};

const TIER_ORDER: FetchTier[] = ["1d", "3d", "7d", "14d", "30d"];

export function selectTier(rangeMs: number): FetchTier {
  for (const tier of TIER_ORDER) {
    if (rangeMs <= TIER_MS[tier]) return tier;
  }
  return "30d";
}

export function autoGranularityMs(rangeMs: number): number {
  const days = rangeMs / 86_400_000;
  if (days <= 3) return 3_600_000; // 1h  -> 24-72 points
  if (days <= 7) return 10_800_000; // 3h  -> 56 points
  if (days <= 14) return 21_600_000; // 6h  -> 56 points
  return 43_200_000; // 12h -> 60 points
}

export interface RawUtilizationBucket {
  timestamp: number;
  gpu: number;
  cpu: number;
  memory: number;
  storage: number;
}

export interface UtilizationResult {
  buckets: RawUtilizationBucket[];
  truncated: boolean;
}

export type MetricKey = "gpu" | "cpu" | "memory" | "storage";

export const MAX_TASK_ROWS = 5_000;

export const UTILIZATION_QUERY_KEY = (tierStart: string, tier: FetchTier) =>
  ["/api/task/utilization", { tierStart, tier }] as const;

interface ParsedTask {
  startMs: number;
  endMs: number;
  gpu: number;
  cpu: number;
  memory: number;
  storage: number;
}

function parseTasks(tasks: ListTaskEntry[], fallbackEndMs: number): ParsedTask[] {
  const result: ParsedTask[] = [];
  for (const task of tasks) {
    if (!task.start_time) continue;
    const startMs = new Date(task.start_time).getTime();
    if (Number.isNaN(startMs)) continue;
    const endMs = task.end_time ? new Date(task.end_time).getTime() : fallbackEndMs;
    result.push({
      startMs,
      endMs: Number.isNaN(endMs) ? fallbackEndMs : endMs,
      gpu: task.gpu,
      cpu: task.cpu,
      memory: task.memory,
      storage: task.storage,
    });
  }
  return result;
}

export function bucketTasks(
  tasks: ListTaskEntry[],
  displayStartMs: number,
  displayEndMs: number,
  granularityMs: number,
): RawUtilizationBucket[] {
  const parsed = parseTasks(tasks, displayEndMs);
  const bucketCount = Math.ceil((displayEndMs - displayStartMs) / granularityMs);
  const buckets: RawUtilizationBucket[] = [];

  for (let i = 0; i < bucketCount; i++) {
    buckets.push({
      timestamp: displayStartMs + i * granularityMs,
      gpu: 0,
      cpu: 0,
      memory: 0,
      storage: 0,
    });
  }

  for (const task of parsed) {
    if (task.endMs <= displayStartMs || task.startMs >= displayEndMs) continue;

    const firstBucket = Math.max(0, Math.floor((task.startMs - displayStartMs) / granularityMs));
    const lastBucket = Math.min(
      bucketCount - 1,
      Math.floor((Math.min(task.endMs, displayEndMs) - displayStartMs - 1) / granularityMs),
    );

    for (let i = firstBucket; i <= lastBucket; i++) {
      buckets[i].gpu += task.gpu;
      buckets[i].cpu += task.cpu;
      buckets[i].memory += task.memory;
      buckets[i].storage += task.storage;
    }
  }

  return buckets;
}
