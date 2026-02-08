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
 * Pool Generator
 *
 * Generates pool data matching PoolResourceUsage from the OpenAPI spec.
 * Uses deterministic seeding for infinite, memory-efficient pagination.
 *
 * Returns data in PoolResponse format for /api/pool_quota endpoint.
 */

import { faker } from "@faker-js/faker";
import { getGlobalMockConfig } from "../global-config";

// Import types directly from generated API spec
import type {
  PoolResourceUsage,
  PoolResources,
  ResourceUsage,
  PoolResponse,
  PoolNodeSetResourceUsage,
  PlatformMinimal,
} from "@/lib/api/generated";
import { PoolStatus } from "@/lib/api/generated";

import { MOCK_CONFIG, type PoolPatterns } from "../seed/types";

// Re-export for convenience
export type { PoolResourceUsage, PoolResponse };
export { PoolStatus };

// ============================================================================
// Generator Configuration
// ============================================================================

interface GeneratorConfig {
  /** Total pools available */
  total: number;
  baseSeed: number;
  patterns: PoolPatterns;
}

const DEFAULT_CONFIG: GeneratorConfig = {
  total: MOCK_CONFIG.volume.pools,
  baseSeed: 54321,
  patterns: MOCK_CONFIG.pools,
};

// ============================================================================
// Generator Class
// ============================================================================

export class PoolGenerator {
  private config: GeneratorConfig;

  constructor(config: Partial<GeneratorConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  get total(): number {
    return getGlobalMockConfig().pools;
  }

  set total(value: number) {
    getGlobalMockConfig().pools = value;
  }

  /**
   * Generate a PoolResourceUsage at a specific index.
   * DETERMINISTIC: Same index always produces the same pool.
   * Matches the format expected by transformPoolsResponse.
   */
  generate(index: number): PoolResourceUsage {
    faker.seed(this.config.baseSeed + index);

    // Generate unique name based on index
    const baseName = this.config.patterns.names[index % this.config.patterns.names.length];
    const name =
      index < this.config.patterns.names.length
        ? baseName
        : `${baseName}-${Math.floor(index / this.config.patterns.names.length)}`;

    const platform = faker.helpers.arrayElement(this.config.patterns.platforms);
    const region = faker.helpers.arrayElement(this.config.patterns.regions);
    const gpuType = faker.helpers.arrayElement(this.config.patterns.gpuTypes);

    // GPU capacity
    const totalGpus = faker.helpers.arrayElement(this.config.patterns.quota.gpuCounts);
    const utilization = faker.number.float(this.config.patterns.quota.utilizationRange);
    const usedGpus = Math.floor(totalGpus * utilization);
    const availableGpus = totalGpus - usedGpus;

    const resources: PoolResources = {
      gpu: {
        guarantee: totalGpus,
        maximum: totalGpus,
        weight: 1,
      },
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

    // Platform configuration - some pools have multiple platforms
    const platforms: Record<string, PlatformMinimal> = {};

    // Always include the primary platform
    platforms[platform] = {
      description: `${gpuType} platform in ${region}`,
      host_network_allowed: false,
      privileged_allowed: false,
      allowed_mounts: ["/data", "/models", "/scratch"],
      default_mounts: ["/data"],
    };

    // ~40% of pools have 2+ platforms, ~20% have 3+, ~10% have 4+
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
        this.config.patterns.platforms.filter((p) => p !== platform),
        Math.min(platformCount - 1, this.config.patterns.platforms.length - 1),
      );
      for (const addPlatform of additionalPlatforms) {
        platforms[addPlatform] = {
          description: `${faker.helpers.arrayElement(this.config.patterns.gpuTypes)} platform`,
          host_network_allowed: faker.datatype.boolean(),
          privileged_allowed: false,
          allowed_mounts: ["/data", "/models"],
          default_mounts: ["/data"],
        };
      }
    }

    return {
      name,
      description: `${gpuType} cluster in ${region} running on ${platform}`,
      status,
      backend: platform,
      default_platform: platform,
      default_exec_timeout: "24h",
      default_queue_timeout: "48h",
      max_exec_timeout: "168h",
      max_queue_timeout: "168h",
      resources,
      resource_usage: resourceUsage,
      platforms,
    };
  }

  /**
   * Generate a page of pools.
   * MEMORY EFFICIENT: Only generates items for the requested page.
   */
  generatePage(offset: number, limit: number): { entries: PoolResourceUsage[]; total: number } {
    const entries: PoolResourceUsage[] = [];
    const total = this.total; // Use getter to read from global config

    const start = Math.max(0, offset);
    const end = Math.min(offset + limit, total);

    for (let i = start; i < end; i++) {
      entries.push(this.generate(i));
    }

    return { entries, total };
  }

  /**
   * Generate PoolResponse for /api/pool_quota endpoint.
   * Returns all pools wrapped in node_sets structure.
   */
  generatePoolResponse(pools?: string[]): PoolResponse {
    let poolList: PoolResourceUsage[];

    if (pools && pools.length > 0) {
      // Filter to specific pools
      poolList = pools.map((name) => this.getByName(name)).filter((p): p is PoolResourceUsage => p !== null);
    } else {
      // Return all pools
      poolList = this.generatePage(0, this.total).entries; // Use getter to read from global config
    }

    // Calculate resource sum
    let totalUsed = 0;
    let totalCapacity = 0;

    for (const pool of poolList) {
      totalUsed += parseInt(pool.resource_usage.quota_used || "0", 10);
      totalCapacity += parseInt(pool.resource_usage.total_capacity || "0", 10);
    }

    const nodeSet: PoolNodeSetResourceUsage = {
      pools: poolList,
    };

    return {
      node_sets: [nodeSet],
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

  /**
   * Get pool by name.
   */
  getByName(name: string): PoolResourceUsage | null {
    // Check known names first
    const knownIndex = this.config.patterns.names.indexOf(name);
    if (knownIndex >= 0 && knownIndex < this.total) {
      // Use getter
      return this.generate(knownIndex);
    }

    // Check generated names (name-N format)
    const match = name.match(/^(.+)-(\d+)$/);
    if (match) {
      const [, baseName, numStr] = match;
      const baseIndex = this.config.patterns.names.indexOf(baseName);
      if (baseIndex >= 0) {
        const index = baseIndex + parseInt(numStr, 10) * this.config.patterns.names.length;
        if (index < this.total) {
          // Use getter
          return this.generate(index);
        }
      }
    }

    // Not found
    return null;
  }

  /**
   * Get all pool names (up to total).
   */
  getPoolNames(): string[] {
    const names: string[] = [];
    for (let i = 0; i < this.total; i++) {
      // Use getter
      const baseName = this.config.patterns.names[i % this.config.patterns.names.length];
      const name =
        i < this.config.patterns.names.length
          ? baseName
          : `${baseName}-${Math.floor(i / this.config.patterns.names.length)}`;
      names.push(name);
    }
    return names;
  }
}

// ============================================================================
// Singleton instance
// ============================================================================

export const poolGenerator = new PoolGenerator();

// ============================================================================
// Configuration helpers
// ============================================================================

export function setPoolTotal(total: number): void {
  poolGenerator.total = total;
}

export function getPoolTotal(): number {
  return poolGenerator.total;
}
