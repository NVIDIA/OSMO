// Copyright (c) 2025, NVIDIA CORPORATION. All rights reserved.
//
// NVIDIA CORPORATION and its licensors retain all intellectual property
// and proprietary rights in and to this software, related documentation
// and any modifications thereto. Any use, reproduction, disclosure or
// distribution of this software and related documentation without an express
// license agreement from NVIDIA CORPORATION is strictly prohibited.

/**
 * Resource (Node) Generator
 *
 * Generates compute node data for pool resource views.
 * Uses deterministic seeding for infinite, memory-efficient pagination.
 *
 * Produces ResourcesEntry objects matching the generated API types.
 */

import { faker } from "@faker-js/faker";
import type { ResourcesEntry, BackendResourceType } from "@/lib/api/generated";

import { MOCK_CONFIG, type ResourcePatterns } from "../seed";

// ============================================================================
// Generator Configuration
// ============================================================================

interface GeneratorConfig {
  /** Resources per pool */
  perPool: number;
  /** Total resources across all pools (for global listing) */
  totalGlobal: number;
  baseSeed: number;
  patterns: ResourcePatterns;
}

const DEFAULT_CONFIG: GeneratorConfig = {
  perPool: MOCK_CONFIG.volume.resourcesPerPool,
  totalGlobal: MOCK_CONFIG.volume.pools * MOCK_CONFIG.volume.resourcesPerPool,
  baseSeed: 67890,
  patterns: MOCK_CONFIG.resources,
};

// ============================================================================
// Generator Class
// ============================================================================

export class ResourceGenerator {
  private config: GeneratorConfig;

  constructor(config: Partial<GeneratorConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  get perPool(): number {
    return this.config.perPool;
  }

  set perPool(value: number) {
    this.config.perPool = value;
  }

  get totalGlobal(): number {
    return this.config.totalGlobal;
  }

  set totalGlobal(value: number) {
    this.config.totalGlobal = value;
  }

  /**
   * Generate a ResourcesEntry for a pool at a specific index.
   * DETERMINISTIC: Same pool + index always produces the same resource.
   */
  generate(poolName: string, index: number): ResourcesEntry {
    faker.seed(this.config.baseSeed + this.hashString(poolName) + index);

    const gpuType = faker.helpers.arrayElement(this.config.patterns.gpuTypes);
    const gpuTotal = faker.helpers.arrayElement(this.config.patterns.gpusPerNode);
    const statusKey = this.pickStatus();

    // Resource usage based on status
    const gpuUsed =
      statusKey === "IN_USE" ? faker.number.int({ min: 1, max: gpuTotal }) : statusKey === "AVAILABLE" ? 0 : gpuTotal; // CORDONED/DRAINING/OFFLINE = unavailable

    const gpuAvailable = gpuTotal - gpuUsed;

    // CPU/Memory based on GPU count
    const cpuPerGpu = faker.number.int(this.config.patterns.cpuPerGpu);
    const memPerGpu = faker.number.int(this.config.patterns.memoryPerGpu);
    const cpuTotal = gpuTotal * cpuPerGpu;
    const cpuUsed = Math.floor(cpuTotal * (gpuUsed / gpuTotal));
    const memTotal = gpuTotal * memPerGpu;
    const memUsed = Math.floor(memTotal * (gpuUsed / gpuTotal));

    // Generate hostname
    const prefix = faker.helpers.arrayElement(this.config.patterns.nodePatterns.prefixes);
    const gpuShort = gpuType.toLowerCase().includes("h100")
      ? "h100"
      : gpuType.toLowerCase().includes("a100")
        ? "a100"
        : gpuType.toLowerCase().includes("l40")
          ? "l40s"
          : "gpu";
    const hostname = `${prefix}-${gpuShort}-${poolName.slice(0, 4)}-${index.toString().padStart(4, "0")}`;

    const platform = faker.helpers.arrayElement(MOCK_CONFIG.pools.platforms);
    const region = faker.helpers.arrayElement(MOCK_CONFIG.pools.regions);

    // Build ResourcesEntry matching the generated type
    const resourceEntry: ResourcesEntry = {
      hostname,
      backend: "kubernetes",
      resource_type: "gpu" as BackendResourceType,

      // Exposed fields: contains node name and pool/platform mapping
      exposed_fields: {
        node: hostname,
        "pool/platform": [`${poolName}/${platform}`],
        "gpu-type": gpuType,
        region,
        status: statusKey,
      },

      // Taints
      taints: statusKey === "CORDONED" ? [{ key: "node.kubernetes.io/unschedulable", effect: "NoSchedule" }] : [],

      // Usage fields: current usage
      usage_fields: {
        gpu: gpuUsed,
        cpu: cpuUsed,
        memory: `${memUsed}Gi`,
      },

      // Non-workflow usage (system overhead)
      non_workflow_usage_fields: {
        gpu: 0,
        cpu: Math.floor(cpuTotal * 0.05),
        memory: `${Math.floor(memTotal * 0.05)}Gi`,
      },

      // Allocatable fields: total capacity
      allocatable_fields: {
        gpu: gpuTotal,
        cpu: cpuTotal,
        memory: `${memTotal}Gi`,
      },

      // Platform allocatable
      platform_allocatable_fields: {
        gpu: gpuTotal,
        cpu: cpuTotal,
        memory: `${memTotal}Gi`,
      },

      // Platform available (allocatable - usage)
      platform_available_fields: {
        gpu: gpuAvailable,
        cpu: cpuTotal - cpuUsed,
        memory: `${memTotal - memUsed}Gi`,
      },

      // Platform workflow allocatable
      platform_workflow_allocatable_fields: {
        gpu: gpuAvailable,
        cpu: cpuTotal - cpuUsed,
        memory: `${memTotal - memUsed}Gi`,
      },

      // Config fields
      config_fields: {
        "cpu-per-gpu": cpuPerGpu,
        "memory-per-gpu": `${memPerGpu}Gi`,
      },

      // Labels
      label_fields: {
        "gpu-type": gpuType,
        pool: poolName,
        "node-type": "gpu",
        region,
      },

      // Pool/Platform labels mapping
      pool_platform_labels: {
        [poolName]: [platform],
      },

      // Conditions
      conditions: this.generateConditions(statusKey),
    };

    return resourceEntry;
  }

  /**
   * Generate a global resource at a specific index (across all pools).
   * DETERMINISTIC: Same index always produces the same resource.
   */
  generateGlobal(index: number, poolNames: string[]): ResourcesEntry {
    // Distribute resources across pools deterministically
    const poolIndex = index % poolNames.length;
    const resourceIndex = Math.floor(index / poolNames.length);
    const poolName = poolNames[poolIndex];
    return this.generate(poolName, resourceIndex);
  }

  /**
   * Generate a page of resources for a pool.
   * MEMORY EFFICIENT: Only generates items for the requested page.
   */
  generatePage(poolName: string, offset: number, limit: number): { resources: ResourcesEntry[]; total: number } {
    const resources: ResourcesEntry[] = [];
    const total = this.config.perPool;

    const start = Math.max(0, offset);
    const end = Math.min(offset + limit, total);

    for (let i = start; i < end; i++) {
      resources.push(this.generate(poolName, i));
    }

    return { resources, total };
  }

  /**
   * Generate a page of resources across all pools.
   * Returns ResourcesResponse format: { resources: [...] }
   */
  generateGlobalPage(
    poolNames: string[],
    offset: number,
    limit: number,
  ): { resources: ResourcesEntry[]; total: number } {
    const resources: ResourcesEntry[] = [];
    const total = this.config.totalGlobal;

    const start = Math.max(0, offset);
    const end = Math.min(offset + limit, total);

    for (let i = start; i < end; i++) {
      resources.push(this.generateGlobal(i, poolNames));
    }

    return { resources, total };
  }

  /**
   * Generate all resources for a pool (for backward compatibility).
   */
  generateForPool(poolName: string): ResourcesEntry[] {
    return this.generatePage(poolName, 0, this.config.perPool).resources;
  }

  /**
   * Generate resources for all pools.
   */
  generateAll(poolNames: string[]): ResourcesEntry[] {
    return this.generateGlobalPage(poolNames, 0, this.config.totalGlobal).resources;
  }

  // --------------------------------------------------------------------------
  // Private helpers
  // --------------------------------------------------------------------------

  private pickStatus(): string {
    const distribution = this.config.patterns.statusDistribution;
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

  private hashString(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash;
    }
    return hash;
  }
}

// ============================================================================
// Singleton instance
// ============================================================================

export const resourceGenerator = new ResourceGenerator();

// ============================================================================
// Configuration helpers
// ============================================================================

export function setResourcePerPool(total: number): void {
  resourceGenerator.perPool = total;
}

export function getResourcePerPool(): number {
  return resourceGenerator.perPool;
}

export function setResourceTotalGlobal(total: number): void {
  resourceGenerator.totalGlobal = total;
}

export function getResourceTotalGlobal(): number {
  return resourceGenerator.totalGlobal;
}
