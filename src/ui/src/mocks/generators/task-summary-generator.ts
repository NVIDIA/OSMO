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
 * Task Summary Generator
 *
 * Generates realistic ListTaskSummaryEntry[] for the occupancy page mock.
 * Each entry is one (user, pool, priority) bucket of aggregated resource usage
 * matching the shape returned by GET /api/task?summary=true.
 *
 * Coverage:
 *   - 33 users with distinct workload profiles
 *   - 12 pools (cloud, on-prem, shared, specialised tiers)
 *   - All three priorities across realistic user/pool combinations
 *   - Edge cases: GPU=0 CPU-only tasks, single-priority users, users spanning
 *     many pools, pools with a single user, heavy vs light users, automated users
 *   - Filter support: users[], pools[], priorities[], limit
 *   - Fully deterministic — seeded so data is stable across hot-reloads
 */

import { faker } from "@faker-js/faker";
import { delay, HttpResponse, passthrough } from "msw";
import type { ListTaskSummaryEntry, ListTaskSummaryResponse } from "@/lib/api/generated";
import { getMockDelay, hashString } from "@/mocks/utils";

const BASE_SEED = 0xdeadbeef;

function rng(key: string, min: number, max: number): number {
  faker.seed(BASE_SEED ^ hashString(key));
  return faker.number.int({ min, max });
}

interface ResourceRange {
  gpu: [number, number];
  cpu: [number, number];
  memory: [number, number]; // GB
  storage: [number, number]; // GB
}

const GPU_XLARGE: ResourceRange = { gpu: [16, 128], cpu: [128, 1024], memory: [1024, 8192], storage: [1000, 20000] };
const GPU_HEAVY: ResourceRange = { gpu: [8, 64], cpu: [64, 512], memory: [512, 4096], storage: [500, 10000] };
const GPU_MED: ResourceRange = { gpu: [2, 16], cpu: [16, 128], memory: [128, 1024], storage: [100, 2000] };
const GPU_LIGHT: ResourceRange = { gpu: [1, 4], cpu: [8, 32], memory: [64, 256], storage: [0, 500] };
const GPU_MINIMAL: ResourceRange = { gpu: [0, 1], cpu: [4, 16], memory: [16, 64], storage: [0, 100] };
const CPU_ONLY: ResourceRange = { gpu: [0, 0], cpu: [8, 64], memory: [32, 256], storage: [0, 1000] };
const INFERENCE: ResourceRange = { gpu: [1, 8], cpu: [8, 32], memory: [64, 512], storage: [0, 200] };
const BENCH: ResourceRange = { gpu: [4, 16], cpu: [32, 128], memory: [256, 1024], storage: [0, 100] };

type Priority = "HIGH" | "NORMAL" | "LOW";

interface PriorityBucket {
  priority: Priority;
  resources: ResourceRange;
}

interface PoolActivity {
  pool: string;
  buckets: PriorityBucket[];
}

interface UserProfile {
  user: string;
  pools: PoolActivity[];
}

const USER_PROFILES: UserProfile[] = [
  {
    user: "alice.chen",
    pools: [
      {
        pool: "dgx-cloud-us-west-2",
        buckets: [
          { priority: "HIGH", resources: GPU_HEAVY },
          { priority: "NORMAL", resources: GPU_MED },
        ],
      },
      {
        pool: "dedicated-h100-80gb",
        buckets: [{ priority: "HIGH", resources: GPU_XLARGE }],
      },
      {
        pool: "gpu-cluster-prod",
        buckets: [{ priority: "NORMAL", resources: GPU_MED }],
      },
    ],
  },

  {
    user: "bob.smith",
    pools: [
      {
        pool: "shared-pool-alpha",
        buckets: [
          { priority: "NORMAL", resources: CPU_ONLY },
          { priority: "LOW", resources: CPU_ONLY },
        ],
      },
      {
        pool: "shared-pool-beta",
        buckets: [{ priority: "LOW", resources: CPU_ONLY }],
      },
      {
        pool: "gpu-cluster-dev",
        buckets: [{ priority: "LOW", resources: GPU_LIGHT }],
      },
    ],
  },

  {
    user: "carol.jones",
    pools: [
      {
        pool: "gpu-cluster-prod",
        buckets: [
          { priority: "HIGH", resources: GPU_HEAVY },
          { priority: "NORMAL", resources: GPU_MED },
        ],
      },
      {
        pool: "dgx-cloud-us-east-1",
        buckets: [
          { priority: "HIGH", resources: GPU_MED },
          { priority: "NORMAL", resources: GPU_LIGHT },
        ],
      },
      {
        pool: "dedicated-a100-80gb",
        buckets: [{ priority: "HIGH", resources: GPU_HEAVY }],
      },
    ],
  },

  {
    user: "david.kim",
    pools: [
      { pool: "dgx-cloud-us-west-2", buckets: [{ priority: "NORMAL", resources: GPU_MED }] },
      { pool: "dgx-cloud-us-east-1", buckets: [{ priority: "NORMAL", resources: GPU_MED }] },
      { pool: "dgx-cloud-eu-west-1", buckets: [{ priority: "HIGH", resources: GPU_LIGHT }] },
      {
        pool: "gpu-cluster-prod",
        buckets: [
          { priority: "NORMAL", resources: GPU_MED },
          { priority: "LOW", resources: GPU_LIGHT },
        ],
      },
      { pool: "gpu-cluster-dev", buckets: [{ priority: "LOW", resources: GPU_LIGHT }] },
      { pool: "shared-pool-alpha", buckets: [{ priority: "NORMAL", resources: CPU_ONLY }] },
    ],
  },

  {
    user: "eve.wilson",
    pools: [
      {
        pool: "inference-pool",
        buckets: [
          { priority: "NORMAL", resources: INFERENCE },
          { priority: "LOW", resources: INFERENCE },
        ],
      },
      {
        pool: "shared-pool-beta",
        buckets: [{ priority: "LOW", resources: INFERENCE }],
      },
    ],
  },

  {
    user: "frank.zhang",
    pools: [
      {
        pool: "benchmark-pool",
        buckets: [
          { priority: "HIGH", resources: BENCH },
          { priority: "NORMAL", resources: GPU_LIGHT },
        ],
      },
      {
        pool: "dgx-cloud-us-west-2",
        buckets: [{ priority: "HIGH", resources: GPU_MED }],
      },
      {
        pool: "dedicated-h100-80gb",
        buckets: [{ priority: "HIGH", resources: BENCH }],
      },
    ],
  },

  {
    user: "grace.lee",
    pools: [
      {
        pool: "research-cluster",
        buckets: [
          { priority: "NORMAL", resources: GPU_MED },
          { priority: "HIGH", resources: GPU_LIGHT },
        ],
      },
      {
        pool: "dgx-cloud-us-west-2",
        buckets: [{ priority: "NORMAL", resources: GPU_LIGHT }],
      },
      {
        pool: "training-pool",
        buckets: [
          { priority: "NORMAL", resources: GPU_MED },
          { priority: "LOW", resources: GPU_LIGHT },
        ],
      },
    ],
  },

  {
    user: "henry.patel",
    pools: [
      {
        pool: "gpu-cluster-dev",
        buckets: [
          { priority: "NORMAL", resources: GPU_LIGHT },
          { priority: "LOW", resources: GPU_MINIMAL },
        ],
      },
    ],
  },

  {
    user: "system-scheduler",
    pools: [
      { pool: "dgx-cloud-us-west-2", buckets: [{ priority: "NORMAL", resources: GPU_MED }] },
      { pool: "dgx-cloud-us-east-1", buckets: [{ priority: "NORMAL", resources: GPU_MED }] },
      { pool: "dgx-cloud-eu-west-1", buckets: [{ priority: "NORMAL", resources: GPU_LIGHT }] },
      { pool: "gpu-cluster-prod", buckets: [{ priority: "NORMAL", resources: GPU_HEAVY }] },
      { pool: "shared-pool-alpha", buckets: [{ priority: "NORMAL", resources: CPU_ONLY }] },
      { pool: "shared-pool-beta", buckets: [{ priority: "NORMAL", resources: CPU_ONLY }] },
      { pool: "training-pool", buckets: [{ priority: "NORMAL", resources: GPU_HEAVY }] },
      { pool: "inference-pool", buckets: [{ priority: "NORMAL", resources: INFERENCE }] },
    ],
  },

  {
    user: "ci-pipeline",
    pools: [
      { pool: "shared-pool-alpha", buckets: [{ priority: "LOW", resources: CPU_ONLY }] },
      { pool: "shared-pool-beta", buckets: [{ priority: "LOW", resources: CPU_ONLY }] },
      {
        pool: "gpu-cluster-dev",
        buckets: [
          { priority: "LOW", resources: GPU_LIGHT },
          { priority: "NORMAL", resources: CPU_ONLY },
        ],
      },
    ],
  },

  // -------------------------------------------------------------------------
  // Additional users to exceed the old 20-user cap for filter testing
  // -------------------------------------------------------------------------
  {
    user: "ivan.novak",
    pools: [
      { pool: "dgx-cloud-us-west-2", buckets: [{ priority: "NORMAL", resources: GPU_MED }] },
      { pool: "gpu-cluster-prod", buckets: [{ priority: "HIGH", resources: GPU_HEAVY }] },
    ],
  },
  {
    user: "julia.martinez",
    pools: [
      { pool: "training-pool", buckets: [{ priority: "NORMAL", resources: GPU_MED }] },
      { pool: "research-cluster", buckets: [{ priority: "LOW", resources: GPU_LIGHT }] },
    ],
  },
  {
    user: "kevin.oshea",
    pools: [
      { pool: "gpu-cluster-dev", buckets: [{ priority: "LOW", resources: GPU_LIGHT }] },
      { pool: "shared-pool-alpha", buckets: [{ priority: "NORMAL", resources: CPU_ONLY }] },
    ],
  },
  {
    user: "linda.nakamura",
    pools: [
      { pool: "dgx-cloud-eu-west-1", buckets: [{ priority: "HIGH", resources: GPU_MED }] },
      { pool: "inference-pool", buckets: [{ priority: "NORMAL", resources: INFERENCE }] },
    ],
  },
  {
    user: "marcus.berg",
    pools: [
      { pool: "dedicated-h100-80gb", buckets: [{ priority: "HIGH", resources: GPU_XLARGE }] },
      { pool: "benchmark-pool", buckets: [{ priority: "NORMAL", resources: BENCH }] },
    ],
  },
  {
    user: "nina.petrova",
    pools: [
      { pool: "gpu-cluster-prod", buckets: [{ priority: "NORMAL", resources: GPU_MED }] },
      { pool: "dgx-cloud-us-east-1", buckets: [{ priority: "LOW", resources: GPU_LIGHT }] },
    ],
  },
  {
    user: "oscar.diaz",
    pools: [
      { pool: "shared-pool-beta", buckets: [{ priority: "LOW", resources: CPU_ONLY }] },
      { pool: "gpu-cluster-dev", buckets: [{ priority: "NORMAL", resources: GPU_MINIMAL }] },
    ],
  },
  {
    user: "priya.sharma",
    pools: [
      { pool: "training-pool", buckets: [{ priority: "HIGH", resources: GPU_HEAVY }] },
      { pool: "dgx-cloud-us-west-2", buckets: [{ priority: "NORMAL", resources: GPU_MED }] },
    ],
  },
  {
    user: "quinn.taylor",
    pools: [
      { pool: "research-cluster", buckets: [{ priority: "NORMAL", resources: GPU_MED }] },
      { pool: "dedicated-a100-80gb", buckets: [{ priority: "HIGH", resources: GPU_HEAVY }] },
    ],
  },
  {
    user: "rafael.costa",
    pools: [
      { pool: "inference-pool", buckets: [{ priority: "LOW", resources: INFERENCE }] },
      { pool: "shared-pool-alpha", buckets: [{ priority: "NORMAL", resources: CPU_ONLY }] },
    ],
  },
  {
    user: "sarah.oconnor",
    pools: [
      { pool: "dgx-cloud-eu-west-1", buckets: [{ priority: "NORMAL", resources: GPU_MED }] },
      { pool: "gpu-cluster-prod", buckets: [{ priority: "HIGH", resources: GPU_HEAVY }] },
    ],
  },
  {
    user: "thomas.weber",
    pools: [
      { pool: "benchmark-pool", buckets: [{ priority: "HIGH", resources: BENCH }] },
      { pool: "dgx-cloud-us-east-1", buckets: [{ priority: "NORMAL", resources: GPU_LIGHT }] },
    ],
  },
  {
    user: "ursula.fischer",
    pools: [
      { pool: "gpu-cluster-dev", buckets: [{ priority: "NORMAL", resources: GPU_LIGHT }] },
      { pool: "training-pool", buckets: [{ priority: "LOW", resources: GPU_MINIMAL }] },
    ],
  },
  {
    user: "victor.santos",
    pools: [
      { pool: "dedicated-h100-80gb", buckets: [{ priority: "NORMAL", resources: GPU_HEAVY }] },
      { pool: "gpu-cluster-prod", buckets: [{ priority: "HIGH", resources: GPU_MED }] },
    ],
  },
  {
    user: "wendy.liu",
    pools: [
      { pool: "dgx-cloud-us-west-2", buckets: [{ priority: "HIGH", resources: GPU_MED }] },
      { pool: "research-cluster", buckets: [{ priority: "NORMAL", resources: GPU_LIGHT }] },
    ],
  },
  {
    user: "xavier.dupont",
    pools: [
      { pool: "shared-pool-beta", buckets: [{ priority: "NORMAL", resources: CPU_ONLY }] },
      { pool: "inference-pool", buckets: [{ priority: "LOW", resources: INFERENCE }] },
    ],
  },
  {
    user: "yuki.tanaka",
    pools: [
      { pool: "dgx-cloud-eu-west-1", buckets: [{ priority: "HIGH", resources: GPU_HEAVY }] },
      { pool: "training-pool", buckets: [{ priority: "NORMAL", resources: GPU_MED }] },
    ],
  },
  {
    user: "zara.ahmed",
    pools: [
      { pool: "gpu-cluster-prod", buckets: [{ priority: "LOW", resources: GPU_LIGHT }] },
      { pool: "dedicated-a100-80gb", buckets: [{ priority: "NORMAL", resources: GPU_MED }] },
    ],
  },
  {
    user: "alex.volkov",
    pools: [
      { pool: "benchmark-pool", buckets: [{ priority: "NORMAL", resources: BENCH }] },
      { pool: "dgx-cloud-us-west-2", buckets: [{ priority: "LOW", resources: GPU_LIGHT }] },
    ],
  },
  {
    user: "bianca.rossi",
    pools: [
      { pool: "shared-pool-alpha", buckets: [{ priority: "LOW", resources: CPU_ONLY }] },
      { pool: "gpu-cluster-dev", buckets: [{ priority: "NORMAL", resources: GPU_MINIMAL }] },
    ],
  },
  {
    user: "carlos.mendoza",
    pools: [
      { pool: "dgx-cloud-us-east-1", buckets: [{ priority: "HIGH", resources: GPU_MED }] },
      { pool: "research-cluster", buckets: [{ priority: "NORMAL", resources: GPU_LIGHT }] },
    ],
  },
  {
    user: "diana.park",
    pools: [
      { pool: "training-pool", buckets: [{ priority: "HIGH", resources: GPU_HEAVY }] },
      { pool: "inference-pool", buckets: [{ priority: "NORMAL", resources: INFERENCE }] },
    ],
  },
  {
    user: "ethan.wright",
    pools: [
      { pool: "gpu-cluster-prod", buckets: [{ priority: "NORMAL", resources: GPU_MED }] },
      { pool: "shared-pool-beta", buckets: [{ priority: "LOW", resources: CPU_ONLY }] },
    ],
  },
];

function buildEntries(): ListTaskSummaryEntry[] {
  const entries: ListTaskSummaryEntry[] = [];

  for (const profile of USER_PROFILES) {
    for (const poolActivity of profile.pools) {
      for (const bucket of poolActivity.buckets) {
        const key = `${profile.user}::${poolActivity.pool}::${bucket.priority}`;
        const { gpu, cpu, memory, storage } = bucket.resources;

        entries.push({
          user: profile.user,
          pool: poolActivity.pool,
          priority: bucket.priority,
          gpu: rng(`${key}:gpu`, gpu[0], gpu[1]),
          cpu: rng(`${key}:cpu`, cpu[0], cpu[1]),
          memory: rng(`${key}:mem`, memory[0], memory[1]),
          storage: rng(`${key}:sto`, storage[0], storage[1]),
        });
      }
    }
  }

  return entries;
}

const ALL_ENTRIES: ListTaskSummaryEntry[] = buildEntries();

interface TaskSummaryFilters {
  users?: string[];
  pools?: string[];
  priorities?: string[];
  limit?: number;
}

export class TaskSummaryGenerator {
  getSummaries(filters: TaskSummaryFilters = {}): ListTaskSummaryEntry[] {
    let result = ALL_ENTRIES;

    if (filters.users && filters.users.length > 0) {
      const userSet = new Set(filters.users);
      result = result.filter((e) => userSet.has(e.user));
    }

    if (filters.pools && filters.pools.length > 0) {
      const poolSet = new Set(filters.pools);
      result = result.filter((e) => e.pool != null && poolSet.has(e.pool));
    }

    if (filters.priorities && filters.priorities.length > 0) {
      const prioritySet = new Set(filters.priorities.map((p) => p.toUpperCase()));
      result = result.filter((e) => prioritySet.has(e.priority.toUpperCase()));
    }

    if (filters.limit != null && filters.limit > 0) {
      result = result.slice(0, filters.limit);
    }

    return result;
  }

  handleGetTaskSummary = async ({ request }: { request: Request }): Promise<Response> => {
    await delay(getMockDelay());
    const url = new URL(request.url);

    if (url.searchParams.get("summary") !== "true") return passthrough();

    const users = url.searchParams.getAll("users");
    const pools = url.searchParams.getAll("pools");
    const priorities = url.searchParams.getAll("priority");
    const limit = parseInt(url.searchParams.get("limit") ?? "10000", 10);

    const summaries = this.getSummaries({
      users: users.length > 0 ? users : undefined,
      pools: pools.length > 0 ? pools : undefined,
      priorities: priorities.length > 0 ? priorities : undefined,
      limit: isNaN(limit) ? undefined : limit,
    });

    return HttpResponse.json<ListTaskSummaryResponse>({ summaries });
  };
}

export const taskSummaryGenerator = new TaskSummaryGenerator();
