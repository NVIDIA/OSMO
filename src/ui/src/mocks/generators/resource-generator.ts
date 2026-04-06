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
import { BackendResourceType, type ResourcesEntry, type ResourcesResponse } from "@/lib/api/generated";
import {
  MOCK_CONFIG,
  SHARED_POOL_ALPHA,
  SHARED_POOL_BETA,
  SHARED_PLATFORM,
  ALPHA_EXTRA_PLATFORM,
} from "@/mocks/seed/types";
import { hashString, getMockDelay } from "@/mocks/utils";
import { getGlobalMockConfig } from "@/mocks/global-config";

const BASE_SEED = 67890;

export class ResourceGenerator {
  get perPool(): number {
    return getGlobalMockConfig().resourcesPerPool;
  }

  get totalGlobal(): number {
    return getGlobalMockConfig().resourcesGlobal;
  }

  generate(poolName: string, index: number): ResourcesEntry {
    // Shared pools use the same seed so they produce identical resources
    const isSharedPool = poolName === SHARED_POOL_ALPHA || poolName === SHARED_POOL_BETA;
    const seedPoolName = isSharedPool ? SHARED_POOL_ALPHA : poolName;
    faker.seed(BASE_SEED + hashString(seedPoolName) + index);

    const gpuType = faker.helpers.arrayElement(MOCK_CONFIG.resources.gpuTypes);
    const gpuTotal = faker.helpers.arrayElement(MOCK_CONFIG.resources.gpusPerNode);
    const statusKey = this.pickStatus();

    const gpuUsed =
      statusKey === "IN_USE" ? faker.number.int({ min: 1, max: gpuTotal }) : statusKey === "AVAILABLE" ? 0 : gpuTotal; // CORDONED/DRAINING/OFFLINE = unavailable

    const gpuAvailable = gpuTotal - gpuUsed;

    const cpuPerGpu = faker.number.int(MOCK_CONFIG.resources.cpuPerGpu);
    const memPerGpu = faker.number.int(MOCK_CONFIG.resources.memoryPerGpu);
    const cpuTotal = gpuTotal * cpuPerGpu;
    const cpuUsed = Math.floor(cpuTotal * (gpuUsed / gpuTotal));
    const memTotal = gpuTotal * memPerGpu;
    const memUsed = Math.floor(memTotal * (gpuUsed / gpuTotal));

    const prefix = faker.helpers.arrayElement(MOCK_CONFIG.resources.nodePatterns.prefixes);
    const gpuShort = gpuType.toLowerCase().includes("h100")
      ? "h100"
      : gpuType.toLowerCase().includes("a100")
        ? "a100"
        : gpuType.toLowerCase().includes("l40")
          ? "l40s"
          : "gpu";
    const uniqueId = faker.string.hexadecimal({ length: 8, casing: "lower", prefix: "" });
    const hostname = `${prefix}-${gpuShort}-${uniqueId}-${index.toString().padStart(4, "0")}`;
    const platform = faker.helpers.arrayElement(MOCK_CONFIG.pools.platforms);
    const region = faker.helpers.arrayElement(MOCK_CONFIG.pools.regions);

    const resourceType: BackendResourceType = isSharedPool ? BackendResourceType.SHARED : BackendResourceType.RESERVED;

    let poolPlatformLabels: Record<string, string[]>;
    let exposedPoolPlatform: string[];
    let labelPool: string;

    if (isSharedPool) {
      const isFirstHalf = index < Math.floor(this.perPool / 2);
      const alphaPlatforms = isFirstHalf ? [SHARED_PLATFORM, ALPHA_EXTRA_PLATFORM] : [SHARED_PLATFORM];

      poolPlatformLabels = {
        [SHARED_POOL_ALPHA]: alphaPlatforms,
        [SHARED_POOL_BETA]: [SHARED_PLATFORM],
      };
      exposedPoolPlatform = [
        ...alphaPlatforms.map((p) => `${SHARED_POOL_ALPHA}/${p}`),
        `${SHARED_POOL_BETA}/${SHARED_PLATFORM}`,
      ];
      labelPool = `${SHARED_POOL_ALPHA},${SHARED_POOL_BETA}`;
    } else {
      poolPlatformLabels = { [poolName]: [platform] };
      exposedPoolPlatform = [`${poolName}/${platform}`];
      labelPool = poolName;
    }

    return {
      hostname,
      backend: "kubernetes",
      resource_type: resourceType,
      exposed_fields: {
        node: hostname,
        "pool/platform": exposedPoolPlatform,
        "gpu-type": gpuType,
        region,
        status: statusKey,
      },
      taints: statusKey === "CORDONED" ? [{ key: "node.kubernetes.io/unschedulable", effect: "NoSchedule" }] : [],
      usage_fields: {
        gpu: gpuUsed,
        cpu: cpuUsed,
        memory: `${memUsed}Gi`,
      },
      non_workflow_usage_fields: {
        gpu: 0,
        cpu: Math.floor(cpuTotal * 0.05),
        memory: `${Math.floor(memTotal * 0.05)}Gi`,
      },
      allocatable_fields: {
        gpu: gpuTotal,
        cpu: cpuTotal,
        memory: `${memTotal}Gi`,
      },
      platform_allocatable_fields: {
        gpu: gpuTotal,
        cpu: cpuTotal,
        memory: `${memTotal}Gi`,
      },
      platform_available_fields: {
        gpu: gpuAvailable,
        cpu: cpuTotal - cpuUsed,
        memory: `${memTotal - memUsed}Gi`,
      },
      platform_workflow_allocatable_fields: {
        gpu: gpuAvailable,
        cpu: cpuTotal - cpuUsed,
        memory: `${memTotal - memUsed}Gi`,
      },
      config_fields: {
        "cpu-per-gpu": cpuPerGpu,
        "memory-per-gpu": `${memPerGpu}Gi`,
      },
      label_fields: {
        "gpu-type": gpuType,
        pool: labelPool,
        "node-type": "gpu",
        region,
      },
      pool_platform_labels: poolPlatformLabels,
      conditions: this.generateConditions(statusKey),
    };
  }

  generateGlobal(index: number, poolNames: string[]): ResourcesEntry {
    const poolIndex = index % poolNames.length;
    const resourceIndex = Math.floor(index / poolNames.length);
    const poolName = poolNames[poolIndex];
    return this.generate(poolName, resourceIndex);
  }

  generatePage(poolName: string, offset: number, limit: number): { resources: ResourcesEntry[]; total: number } {
    const resources: ResourcesEntry[] = [];
    const total = this.perPool;

    const start = Math.max(0, offset);
    const end = Math.min(offset + limit, total);

    for (let i = start; i < end; i++) {
      resources.push(this.generate(poolName, i));
    }

    return { resources, total };
  }

  generateGlobalPage(
    poolNames: string[],
    offset: number,
    limit: number,
  ): { resources: ResourcesEntry[]; total: number } {
    const resources: ResourcesEntry[] = [];
    const total = this.totalGlobal;

    const start = Math.max(0, offset);
    const end = Math.min(offset + limit, total);

    for (let i = start; i < end; i++) {
      resources.push(this.generateGlobal(i, poolNames));
    }

    return { resources, total };
  }

  private pickStatus(): string {
    const distribution = MOCK_CONFIG.resources.statusDistribution;
    const rand = faker.number.float({ min: 0, max: 1 });
    let cumulative = 0;

    for (const [status, prob] of Object.entries(distribution)) {
      cumulative += prob;
      if (rand <= cumulative) {
        return status;
      }
    }

    return "AVAILABLE";
  }

  handleListResources = async (request: Request, poolNames: string[]): Promise<ResourcesResponse> => {
    await delay(getMockDelay());
    const url = new URL(request.url);
    const poolsParam = url.searchParams.get("pools");
    const allPools = url.searchParams.get("all_pools") === "true";

    if (allPools) {
      if (poolNames.length === 0) {
        return { resources: [] };
      }
      const { resources } = this.generateGlobalPage(poolNames, 0, this.totalGlobal);
      return { resources };
    }

    if (poolsParam) {
      const requestedPools = poolsParam.split(",").map((p) => p.trim());
      const sharedPools = [SHARED_POOL_ALPHA, SHARED_POOL_BETA];
      const hasMultipleShared = sharedPools.filter((sp) => requestedPools.includes(sp)).length > 1;
      const poolsToQuery = hasMultipleShared ? requestedPools.filter((p) => p !== SHARED_POOL_BETA) : requestedPools;
      const allResources: ResourcesEntry[] = [];
      for (const pool of poolsToQuery) {
        const { resources } = this.generatePage(pool, 0, this.perPool);
        allResources.push(...resources);
      }
      return { resources: allResources };
    }

    const defaultPool = poolNames.length > 0 ? poolNames[0] : "default-pool";
    const { resources } = this.generatePage(defaultPool, 0, this.perPool);
    return { resources };
  };

  private generateConditions(status: string): string[] {
    const conditions = [
      status === "OFFLINE" ? "Ready=False" : "Ready=True",
      "MemoryPressure=False",
      "DiskPressure=False",
      "PIDPressure=False",
      "NetworkUnavailable=False",
    ];

    if (status === "CORDONED") {
      conditions.push("Unschedulable=True");
    }

    return conditions;
  }
}

export const resourceGenerator = new ResourceGenerator();
