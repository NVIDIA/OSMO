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
 * Generates deterministic ListTaskEntry[] for the utilization dashboard mock.
 * Tasks span the last 35 days with varied workload profiles, temporal patterns,
 * and edge cases (still-running, zero-GPU, pre-window spans).
 */

import { faker } from "@faker-js/faker";
import type { ListTaskEntry } from "@/lib/api/generated";
import { TaskGroupStatus } from "@/lib/api/generated";
import { MOCK_CONFIG } from "@/mocks/seed/types";
import { hashString } from "@/mocks/utils";

const BASE_SEED = 0xcafe_babe;
const MS_PER_HOUR = 3_600_000;
const MS_PER_DAY = 86_400_000;
const GENERATION_WINDOW_DAYS = 35;

const USERS = MOCK_CONFIG.workflows.users;
const POOLS = [
  "dgx-cloud-us-west-2",
  "dgx-cloud-us-east-1",
  "gpu-cluster-prod",
  "gpu-cluster-dev",
  "shared-pool-alpha",
  "dedicated-h100-80gb",
  "training-pool",
  "inference-pool",
  "benchmark-pool",
  "research-cluster",
];

interface WorkloadProfile {
  name: string;
  weight: number;
  gpu: [number, number];
  cpu: [number, number];
  memory: [number, number];
  storage: [number, number];
  durationHours: [number, number];
  statuses: { status: TaskGroupStatus; weight: number }[];
  overnightBias: boolean;
}

const WORKLOADS: WorkloadProfile[] = [
  {
    name: "large-training",
    weight: 0.08,
    gpu: [16, 128],
    cpu: [128, 1024],
    memory: [1024, 8192],
    storage: [1000, 10000],
    durationHours: [8, 72],
    statuses: [
      { status: TaskGroupStatus.COMPLETED, weight: 0.6 },
      { status: TaskGroupStatus.RUNNING, weight: 0.15 },
      { status: TaskGroupStatus.FAILED, weight: 0.1 },
      { status: TaskGroupStatus.FAILED_EXEC_TIMEOUT, weight: 0.1 },
      { status: TaskGroupStatus.FAILED_EVICTED, weight: 0.05 },
    ],
    overnightBias: true,
  },
  {
    name: "medium-training",
    weight: 0.25,
    gpu: [2, 8],
    cpu: [16, 64],
    memory: [128, 512],
    storage: [100, 1000],
    durationHours: [2, 12],
    statuses: [
      { status: TaskGroupStatus.COMPLETED, weight: 0.65 },
      { status: TaskGroupStatus.RUNNING, weight: 0.1 },
      { status: TaskGroupStatus.FAILED, weight: 0.15 },
      { status: TaskGroupStatus.FAILED_IMAGE_PULL, weight: 0.05 },
      { status: TaskGroupStatus.FAILED_PREEMPTED, weight: 0.05 },
    ],
    overnightBias: false,
  },
  {
    name: "short-experiment",
    weight: 0.25,
    gpu: [1, 4],
    cpu: [8, 32],
    memory: [32, 128],
    storage: [0, 100],
    durationHours: [0.25, 2],
    statuses: [
      { status: TaskGroupStatus.COMPLETED, weight: 0.7 },
      { status: TaskGroupStatus.FAILED, weight: 0.2 },
      { status: TaskGroupStatus.FAILED_START_ERROR, weight: 0.05 },
      { status: TaskGroupStatus.RUNNING, weight: 0.05 },
    ],
    overnightBias: false,
  },
  {
    name: "inference",
    weight: 0.12,
    gpu: [1, 4],
    cpu: [4, 16],
    memory: [16, 64],
    storage: [0, 50],
    durationHours: [0.5, 48],
    statuses: [
      { status: TaskGroupStatus.RUNNING, weight: 0.35 },
      { status: TaskGroupStatus.COMPLETED, weight: 0.55 },
      { status: TaskGroupStatus.FAILED, weight: 0.1 },
    ],
    overnightBias: false,
  },
  {
    name: "cpu-preprocessing",
    weight: 0.15,
    gpu: [0, 0],
    cpu: [8, 64],
    memory: [32, 256],
    storage: [100, 2000],
    durationHours: [0.5, 4],
    statuses: [
      { status: TaskGroupStatus.COMPLETED, weight: 0.8 },
      { status: TaskGroupStatus.RUNNING, weight: 0.05 },
      { status: TaskGroupStatus.FAILED, weight: 0.1 },
      { status: TaskGroupStatus.FAILED_EXEC_TIMEOUT, weight: 0.05 },
    ],
    overnightBias: false,
  },
  {
    name: "benchmark",
    weight: 0.08,
    gpu: [4, 16],
    cpu: [32, 128],
    memory: [256, 512],
    storage: [0, 50],
    durationHours: [0.08, 1],
    statuses: [
      { status: TaskGroupStatus.COMPLETED, weight: 0.85 },
      { status: TaskGroupStatus.FAILED, weight: 0.1 },
      { status: TaskGroupStatus.RUNNING, weight: 0.05 },
    ],
    overnightBias: false,
  },
  {
    name: "long-running-service",
    weight: 0.07,
    gpu: [1, 8],
    cpu: [8, 32],
    memory: [64, 256],
    storage: [0, 20],
    durationHours: [24, 168],
    statuses: [
      { status: TaskGroupStatus.RUNNING, weight: 0.5 },
      { status: TaskGroupStatus.COMPLETED, weight: 0.3 },
      { status: TaskGroupStatus.FAILED_EVICTED, weight: 0.1 },
      { status: TaskGroupStatus.FAILED_PREEMPTED, weight: 0.1 },
    ],
    overnightBias: false,
  },
];

function seededInt(key: string, min: number, max: number): number {
  faker.seed(BASE_SEED ^ hashString(key));
  return faker.number.int({ min, max });
}

function seededFloat(key: string, min: number, max: number): number {
  faker.seed(BASE_SEED ^ hashString(key));
  return faker.number.float({ min, max, multipleOf: 0.01 });
}

function seededChoice<T>(key: string, arr: readonly T[]): T {
  faker.seed(BASE_SEED ^ hashString(key));
  return faker.helpers.arrayElement(arr as T[]);
}

function seededWeighted<T>(key: string, items: { value: T; weight: number }[]): T {
  faker.seed(BASE_SEED ^ hashString(key));
  return faker.helpers.weightedArrayElement(items.map((i) => ({ value: i.value, weight: i.weight })));
}

function pickWorkload(taskIndex: number): WorkloadProfile {
  return seededWeighted(
    `workload:${taskIndex}`,
    WORKLOADS.map((w) => ({ value: w, weight: w.weight })),
  );
}

function generateStartHour(taskIndex: number, workload: WorkloadProfile): number {
  const key = `hour:${taskIndex}`;
  if (workload.overnightBias) {
    return seededFloat(key, 17, 23);
  }
  const roll = seededFloat(`${key}:roll`, 0, 1);
  if (roll < 0.7) {
    return seededFloat(key, 8, 20);
  }
  return seededFloat(key, 0, 24);
}

function generateTask(taskIndex: number, nowMs: number): ListTaskEntry {
  const workload = pickWorkload(taskIndex);
  const key = `task:${taskIndex}`;

  const daysAgo = seededFloat(`${key}:day`, 0, GENERATION_WINDOW_DAYS);
  const dayOfWeek = new Date(nowMs - daysAgo * MS_PER_DAY).getDay();
  const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

  if (isWeekend && seededFloat(`${key}:weekend-skip`, 0, 1) > 0.3) {
    return generateTask(taskIndex + 500, nowMs);
  }

  const startHour = generateStartHour(taskIndex, workload);
  const startMs = nowMs - daysAgo * MS_PER_DAY + startHour * MS_PER_HOUR;
  const durationMs = seededFloat(`${key}:dur`, workload.durationHours[0], workload.durationHours[1]) * MS_PER_HOUR;

  const status = seededWeighted(
    `${key}:status`,
    workload.statuses.map((s) => ({ value: s.status, weight: s.weight })),
  );

  const isStillRunning = status === TaskGroupStatus.RUNNING;
  const endMs = isStillRunning ? undefined : startMs + durationMs;
  const endTime = endMs != null ? new Date(endMs).toISOString() : undefined;
  const duration = endMs != null ? Math.round((endMs - startMs) / 1000) : undefined;

  const gpu = seededInt(`${key}:gpu`, workload.gpu[0], workload.gpu[1]);
  const cpu = seededInt(`${key}:cpu`, workload.cpu[0], workload.cpu[1]);
  const memory = seededInt(`${key}:mem`, workload.memory[0], workload.memory[1]);
  const storage = seededInt(`${key}:sto`, workload.storage[0], workload.storage[1]);

  const user = seededChoice(`${key}:user`, USERS);
  const pool = seededChoice(`${key}:pool`, POOLS);
  const node = `node-${pool.slice(0, 3)}-${seededInt(`${key}:node`, 1, 50).toString().padStart(3, "0")}`;
  const priority = seededChoice(`${key}:pri`, ["HIGH", "NORMAL", "LOW"] as const);

  const prefix = seededChoice(`${key}:prefix`, MOCK_CONFIG.workflows.namePatterns.prefixes);
  const suffix = seededChoice(`${key}:suffix`, MOCK_CONFIG.workflows.namePatterns.suffixes);
  const workflowName = `${prefix}-${suffix}-${taskIndex.toString(16).padStart(4, "0")}`;
  const taskName = `${workload.name}-${seededInt(`${key}:tidx`, 0, 7)}`;

  return {
    user,
    workflow_id: workflowName,
    workflow_uuid: `${workflowName}-uuid-${taskIndex}`,
    task_name: taskName,
    retry_id: 0,
    pool,
    node,
    start_time: new Date(startMs).toISOString(),
    end_time: endTime,
    duration,
    status,
    overview: `${workload.name} task`,
    logs: `/api/workflow/${workflowName}/task/${taskName}/logs`,
    priority,
    gpu,
    cpu,
    memory,
    storage,
  };
}

const NOW_MS = Date.now();
const TASK_COUNT = 420;

const ALL_TASKS: ListTaskEntry[] = [];
for (let i = 0; i < TASK_COUNT; i++) {
  ALL_TASKS.push(generateTask(i, NOW_MS));
}

ALL_TASKS.sort((a, b) => {
  const aTime = a.start_time ? new Date(a.start_time).getTime() : 0;
  const bTime = b.start_time ? new Date(b.start_time).getTime() : 0;
  return bTime - aTime;
});

export interface UtilizationTaskFilters {
  started_before?: string;
  ended_after?: string;
  limit?: number;
  offset?: number;
}

export class UtilizationGenerator {
  /**
   * Return tasks that were active during the specified window.
   *
   * A task is "active" during [ended_after, started_before] if:
   *   task.start_time < started_before  AND  (task.end_time >= ended_after  OR  task.end_time IS NULL)
   *
   * Mirrors the SQL filter in helpers.py.
   */
  getTasks(filters: UtilizationTaskFilters = {}): { tasks: ListTaskEntry[]; total: number } {
    let result = ALL_TASKS;

    if (filters.started_before) {
      const before = new Date(filters.started_before).getTime();
      result = result.filter((t) => {
        if (!t.start_time) return false;
        return new Date(t.start_time).getTime() < before;
      });
    }

    if (filters.ended_after) {
      const after = new Date(filters.ended_after).getTime();
      result = result.filter((t) => {
        if (!t.end_time) return true;
        return new Date(t.end_time).getTime() >= after;
      });
    }

    const total = result.length;
    const offset = filters.offset ?? 0;
    const limit = filters.limit ?? 1000;

    return {
      tasks: result.slice(offset, offset + limit),
      total,
    };
  }

  /** Total number of generated tasks. */
  get totalTasks(): number {
    return ALL_TASKS.length;
  }

  /** Summary stats for debugging. */
  getStats(): {
    total: number;
    running: number;
    completed: number;
    failed: number;
    gpuZero: number;
    maxGpu: number;
  } {
    let running = 0;
    let completed = 0;
    let failed = 0;
    let gpuZero = 0;
    let maxGpu = 0;

    for (const t of ALL_TASKS) {
      if (t.status === TaskGroupStatus.RUNNING) running++;
      else if (t.status === TaskGroupStatus.COMPLETED) completed++;
      else if (t.status.toString().startsWith("FAILED")) failed++;
      if (t.gpu === 0) gpuZero++;
      if (t.gpu > maxGpu) maxGpu = t.gpu;
    }

    return { total: ALL_TASKS.length, running, completed, failed, gpuZero, maxGpu };
  }
}

export const utilizationGenerator = new UtilizationGenerator();
