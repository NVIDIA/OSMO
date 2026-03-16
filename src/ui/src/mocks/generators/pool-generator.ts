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

import { faker } from "@faker-js/faker";
import { delay } from "msw";
import { getMockDelay } from "@/mocks/utils";
import { getGlobalMockConfig } from "@/mocks/global-config";
import type {
  PoolResourceUsage,
  PoolResources,
  ResourceUsage,
  PoolResponse,
  PlatformMinimal,
} from "@/lib/api/generated";
import { PoolStatus } from "@/lib/api/generated";
import {
  MOCK_CONFIG,
  SHARED_POOL_ALPHA,
  SHARED_POOL_BETA,
  SHARED_PLATFORM,
  ALPHA_EXTRA_PLATFORM,
} from "@/mocks/seed/types";

const BASE_SEED = 54321;

export class PoolGenerator {
  get total(): number {
    return getGlobalMockConfig().pools;
  }

  generate(index: number): PoolResourceUsage {
    faker.seed(BASE_SEED + index);

    const name = this.nameForIndex(index);
    const platform = faker.helpers.arrayElement(MOCK_CONFIG.pools.platforms);
    const region = faker.helpers.arrayElement(MOCK_CONFIG.pools.regions);
    const gpuType = faker.helpers.arrayElement(MOCK_CONFIG.pools.gpuTypes);

    const totalGpus = faker.helpers.arrayElement(MOCK_CONFIG.pools.quota.gpuCounts);
    // Index 1: simulate oversubscribed pool where usage exceeds capacity
    const isOversubscribed = index === 1;
    const utilization = isOversubscribed ? 1.2 : faker.number.float(MOCK_CONFIG.pools.quota.utilizationRange);
    const usedGpus = Math.floor(totalGpus * utilization);
    const availableGpus = totalGpus - usedGpus;

    const resources: PoolResources = {
      gpu: { guarantee: totalGpus, maximum: totalGpus, weight: 1 },
    };

    const resourceUsage: ResourceUsage = {
      quota_used: `${usedGpus}`,
      quota_free: `${availableGpus}`,
      quota_limit: `${totalGpus}`,
      total_usage: `${usedGpus}`,
      total_capacity: `${totalGpus}`,
      total_free: `${availableGpus}`,
    };

    const status = faker.helpers.weightedArrayElement([
      { value: PoolStatus.ONLINE, weight: 0.85 },
      { value: PoolStatus.OFFLINE, weight: 0.08 },
      { value: PoolStatus.MAINTENANCE, weight: 0.07 },
    ]);

    const platforms: Record<string, PlatformMinimal> = {};
    const isSharedPool = name === SHARED_POOL_ALPHA || name === SHARED_POOL_BETA;

    if (isSharedPool) {
      platforms[SHARED_PLATFORM] = {
        description: `${gpuType} shared platform in ${region}`,
        host_network_allowed: false,
        privileged_allowed: false,
        allowed_mounts: ["/data", "/models", "/scratch"],
        default_mounts: ["/data"],
      };
      if (name === SHARED_POOL_ALPHA) {
        platforms[ALPHA_EXTRA_PLATFORM] = {
          description: `${gpuType} on-prem platform`,
          host_network_allowed: true,
          privileged_allowed: false,
          allowed_mounts: ["/data", "/models"],
          default_mounts: ["/data"],
        };
      }
    } else {
      platforms[platform] = {
        description: `${gpuType} platform in ${region}`,
        host_network_allowed: false,
        privileged_allowed: false,
        allowed_mounts: ["/data", "/models", "/scratch"],
        default_mounts: ["/data"],
      };

      const platformCount = faker.helpers.weightedArrayElement([
        { value: 1, weight: 0.4 },
        { value: 2, weight: 0.25 },
        { value: 3, weight: 0.15 },
        { value: 4, weight: 0.1 },
        { value: 5, weight: 0.05 },
        { value: 6, weight: 0.03 },
        { value: 7, weight: 0.02 },
      ]);

      if (platformCount > 1) {
        const additionalPlatforms = faker.helpers.arrayElements(
          MOCK_CONFIG.pools.platforms.filter((p) => p !== platform),
          Math.min(platformCount - 1, MOCK_CONFIG.pools.platforms.length - 1),
        );
        for (const addPlatform of additionalPlatforms) {
          platforms[addPlatform] = {
            description: `${faker.helpers.arrayElement(MOCK_CONFIG.pools.gpuTypes)} platform`,
            host_network_allowed: faker.datatype.boolean(),
            privileged_allowed: false,
            allowed_mounts: ["/data", "/models"],
            default_mounts: ["/data"],
          };
        }
      }
    }

    const effectivePlatform = isSharedPool ? SHARED_PLATFORM : platform;

    return {
      name,
      description: `${gpuType} cluster in ${region} running on ${effectivePlatform}`,
      status,
      backend: effectivePlatform,
      default_platform: effectivePlatform,
      default_exec_timeout: "24h",
      default_queue_timeout: "48h",
      max_exec_timeout: "168h",
      max_queue_timeout: "168h",
      resources,
      resource_usage: resourceUsage,
      platforms,
    };
  }

  generatePoolResponse(pools?: string[]): PoolResponse {
    const poolList = pools?.length
      ? pools.map((name) => this.getByName(name)).filter((p): p is PoolResourceUsage => p !== null)
      : Array.from({ length: this.total }, (_, i) => this.generate(i));

    let totalUsed = 0;
    let totalCapacity = 0;
    for (const pool of poolList) {
      totalUsed += parseInt(pool.resource_usage.quota_used || "0", 10);
      totalCapacity += parseInt(pool.resource_usage.total_capacity || "0", 10);
    }

    return {
      node_sets: [{ pools: poolList }],
      resource_sum: {
        quota_used: `${totalUsed}`,
        quota_free: `${totalCapacity - totalUsed}`,
        quota_limit: `${totalCapacity}`,
        total_usage: `${totalUsed}`,
        total_capacity: `${totalCapacity}`,
        total_free: `${totalCapacity - totalUsed}`,
      },
    };
  }

  getByName(name: string): PoolResourceUsage | null {
    const knownIndex = MOCK_CONFIG.pools.names.indexOf(name);
    if (knownIndex >= 0 && knownIndex < this.total) {
      return this.generate(knownIndex);
    }

    const match = name.match(/^(.+)-(\d+)$/);
    if (match) {
      const [, baseName, numStr] = match;
      const baseIndex = MOCK_CONFIG.pools.names.indexOf(baseName);
      if (baseIndex >= 0) {
        const index = baseIndex + parseInt(numStr, 10) * MOCK_CONFIG.pools.names.length;
        if (index < this.total) {
          return this.generate(index);
        }
      }
    }

    return null;
  }

  getPoolNames(): string[] {
    return Array.from({ length: this.total }, (_, i) => this.nameForIndex(i));
  }

  private nameForIndex(index: number): string {
    const baseName = MOCK_CONFIG.pools.names[index % MOCK_CONFIG.pools.names.length];
    return index < MOCK_CONFIG.pools.names.length
      ? baseName
      : `${baseName}-${Math.floor(index / MOCK_CONFIG.pools.names.length)}`;
  }

  handleGetPoolQuota = async ({ request }: { request: Request }): Promise<PoolResponse> => {
    await delay(getMockDelay());
    const url = new URL(request.url);
    const poolsParam = url.searchParams.get("pools");
    if (poolsParam && url.searchParams.get("all_pools") !== "true") {
      return this.generatePoolResponse(poolsParam.split(",").map((p) => p.trim()));
    }
    return this.generatePoolResponse();
  };

  handleListPools = async ({ request }: { request: Request }): Promise<Response> => {
    await delay(getMockDelay());
    const url = new URL(request.url);
    const allPools = url.searchParams.get("all_pools") === "true";
    const poolsParam = url.searchParams.get("pools");
    let poolNames: string[];
    if (poolsParam) {
      poolNames = poolsParam.split(",").map((p) => p.trim());
    } else if (allPools) {
      poolNames = this.getPoolNames();
    } else {
      poolNames = this.getPoolNames().slice(0, 10);
    }
    return new Response(poolNames.join("\n"), { headers: { "Content-Type": "text/plain" } });
  };
}

export const poolGenerator = new PoolGenerator();
