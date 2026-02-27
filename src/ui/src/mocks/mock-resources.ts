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
 * Preset Mock Pools & Resources
 *
 * Generates a fixed set of pools and resources that demonstrates
 * cross-pool / cross-platform sharing:
 *
 * - Pool "gpu-cluster-alpha" has two platforms: "kubernetes" and "dgx-cloud"
 * - Pool "gpu-cluster-beta" has one platform: "kubernetes"
 * - All 8 resources are shared between alpha/kubernetes and beta/kubernetes
 * - Only the first 4 resources are also on alpha/dgx-cloud (half)
 *
 * This makes it easy to verify pool/platform filtering, aggregation, and
 * the detail panel's pool membership display.
 */

import { BackendResourceType, type ResourcesEntry, PoolStatus } from "@/lib/api/generated";
import type { PoolResourceUsage } from "@/lib/api/generated";

// =============================================================================
// Pool & Platform Constants
// =============================================================================

const POOL_ALPHA = "gpu-cluster-alpha";
const POOL_BETA = "gpu-cluster-beta";
const PLATFORM_KUBERNETES = "kubernetes";
const PLATFORM_DGX = "dgx-cloud";

// =============================================================================
// Resource Constants
// =============================================================================

const GPU_TYPE = "NVIDIA-H100-80GB-HBM3";
const GPUS_PER_NODE = 8;
const CPU_PER_GPU = 16;
const MEM_PER_GPU = 128; // GiB
const TOTAL_CPU = GPUS_PER_NODE * CPU_PER_GPU; // 128
const TOTAL_MEM = GPUS_PER_NODE * MEM_PER_GPU; // 1024

// =============================================================================
// Preset Pools
// =============================================================================

const MOCK_POOL_ALPHA: PoolResourceUsage = {
  name: POOL_ALPHA,
  description: `${GPU_TYPE} cluster in us-west-2 with kubernetes and dgx-cloud platforms`,
  status: PoolStatus.ONLINE,
  backend: PLATFORM_KUBERNETES,
  default_platform: PLATFORM_KUBERNETES,
  default_exec_timeout: "24h",
  default_queue_timeout: "48h",
  max_exec_timeout: "168h",
  max_queue_timeout: "168h",
  resources: {
    gpu: { guarantee: 64, maximum: 64, weight: 1 },
  },
  resource_usage: {
    quota_used: "20",
    quota_free: "44",
    quota_limit: "64",
    total_usage: "20",
    total_capacity: "64",
    total_free: "44",
  },
  platforms: {
    [PLATFORM_KUBERNETES]: {
      description: `${GPU_TYPE} platform in us-west-2`,
      host_network_allowed: false,
      privileged_allowed: false,
      allowed_mounts: ["/data", "/models", "/scratch"],
      default_mounts: ["/data"],
    },
    [PLATFORM_DGX]: {
      description: `${GPU_TYPE} DGX Cloud platform`,
      host_network_allowed: true,
      privileged_allowed: false,
      allowed_mounts: ["/data", "/models"],
      default_mounts: ["/data"],
    },
  },
};

const MOCK_POOL_BETA: PoolResourceUsage = {
  name: POOL_BETA,
  description: `${GPU_TYPE} cluster in us-west-2 with kubernetes platform`,
  status: PoolStatus.ONLINE,
  backend: PLATFORM_KUBERNETES,
  default_platform: PLATFORM_KUBERNETES,
  default_exec_timeout: "24h",
  default_queue_timeout: "48h",
  max_exec_timeout: "168h",
  max_queue_timeout: "168h",
  resources: {
    gpu: { guarantee: 64, maximum: 64, weight: 1 },
  },
  resource_usage: {
    quota_used: "20",
    quota_free: "44",
    quota_limit: "64",
    total_usage: "20",
    total_capacity: "64",
    total_free: "44",
  },
  platforms: {
    [PLATFORM_KUBERNETES]: {
      description: `${GPU_TYPE} platform in us-west-2`,
      host_network_allowed: false,
      privileged_allowed: false,
      allowed_mounts: ["/data", "/models", "/scratch"],
      default_mounts: ["/data"],
    },
  },
};

// =============================================================================
// Preset Resources
// =============================================================================

interface ResourceSeed {
  hostname: string;
  status: "AVAILABLE" | "IN_USE" | "CORDONED" | "OFFLINE";
  gpuUsed: number;
  /** Whether this resource also appears on alpha/dgx-cloud (first half only) */
  onDgxCloud: boolean;
}

const RESOURCE_SEEDS: ResourceSeed[] = [
  // First half — on all three pool/platform combos (alpha/k8s, alpha/dgx, beta/k8s)
  { hostname: "dgx-h100-alpha-0001", status: "IN_USE", gpuUsed: 8, onDgxCloud: true },
  { hostname: "dgx-h100-alpha-0002", status: "IN_USE", gpuUsed: 4, onDgxCloud: true },
  { hostname: "dgx-h100-alpha-0003", status: "AVAILABLE", gpuUsed: 0, onDgxCloud: true },
  { hostname: "dgx-h100-alpha-0004", status: "CORDONED", gpuUsed: 0, onDgxCloud: true },
  // Second half — only on alpha/kubernetes and beta/kubernetes
  { hostname: "dgx-h100-beta-0001", status: "IN_USE", gpuUsed: 6, onDgxCloud: false },
  { hostname: "dgx-h100-beta-0002", status: "AVAILABLE", gpuUsed: 0, onDgxCloud: false },
  { hostname: "dgx-h100-beta-0003", status: "IN_USE", gpuUsed: 2, onDgxCloud: false },
  { hostname: "dgx-h100-beta-0004", status: "OFFLINE", gpuUsed: 0, onDgxCloud: false },
];

function buildResourceEntry(seed: ResourceSeed): ResourcesEntry {
  const { hostname, status, gpuUsed, onDgxCloud } = seed;

  const gpuAvailable = GPUS_PER_NODE - gpuUsed;
  const cpuUsed = Math.floor(TOTAL_CPU * (gpuUsed / GPUS_PER_NODE));
  const memUsed = Math.floor(TOTAL_MEM * (gpuUsed / GPUS_PER_NODE));

  // Build pool/platform arrays
  const poolPlatformList: string[] = [`${POOL_ALPHA}/${PLATFORM_KUBERNETES}`, `${POOL_BETA}/${PLATFORM_KUBERNETES}`];

  const poolPlatformLabels: Record<string, string[]> = {
    [POOL_ALPHA]: [PLATFORM_KUBERNETES],
    [POOL_BETA]: [PLATFORM_KUBERNETES],
  };

  if (onDgxCloud) {
    poolPlatformList.push(`${POOL_ALPHA}/${PLATFORM_DGX}`);
    poolPlatformLabels[POOL_ALPHA] = [PLATFORM_KUBERNETES, PLATFORM_DGX];
  }

  // UNUSED only applies to resources with no pool membership.
  // These resources all belong to pools, so they are SHARED or RESERVED.
  const resourceType: BackendResourceType =
    gpuUsed === GPUS_PER_NODE ? BackendResourceType.RESERVED : BackendResourceType.SHARED;

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

  return {
    hostname,
    backend: "kubernetes",
    resource_type: resourceType,

    exposed_fields: {
      node: hostname,
      "pool/platform": poolPlatformList,
      "gpu-type": GPU_TYPE,
      region: "us-west-2",
      status,
    },

    taints: status === "CORDONED" ? [{ key: "node.kubernetes.io/unschedulable", effect: "NoSchedule" }] : [],

    usage_fields: {
      gpu: gpuUsed,
      cpu: cpuUsed,
      memory: `${memUsed}Gi`,
    },

    non_workflow_usage_fields: {
      gpu: 0,
      cpu: Math.floor(TOTAL_CPU * 0.05),
      memory: `${Math.floor(TOTAL_MEM * 0.05)}Gi`,
    },

    allocatable_fields: {
      gpu: GPUS_PER_NODE,
      cpu: TOTAL_CPU,
      memory: `${TOTAL_MEM}Gi`,
    },

    platform_allocatable_fields: {
      gpu: GPUS_PER_NODE,
      cpu: TOTAL_CPU,
      memory: `${TOTAL_MEM}Gi`,
    },

    platform_available_fields: {
      gpu: gpuAvailable,
      cpu: TOTAL_CPU - cpuUsed,
      memory: `${TOTAL_MEM - memUsed}Gi`,
    },

    platform_workflow_allocatable_fields: {
      gpu: gpuAvailable,
      cpu: TOTAL_CPU - cpuUsed,
      memory: `${TOTAL_MEM - memUsed}Gi`,
    },

    config_fields: {
      "cpu-per-gpu": CPU_PER_GPU,
      "memory-per-gpu": `${MEM_PER_GPU}Gi`,
    },

    label_fields: {
      "gpu-type": GPU_TYPE,
      pool: POOL_ALPHA,
      "node-type": "gpu",
      region: "us-west-2",
    },

    pool_platform_labels: poolPlatformLabels,

    conditions,
  };
}

// =============================================================================
// Public API
// =============================================================================

/** Names of the preset pools. */
export const MOCK_POOL_NAMES = [POOL_ALPHA, POOL_BETA] as const;

/** Get the two preset PoolResourceUsage objects. */
export function getMockPools(): PoolResourceUsage[] {
  return [MOCK_POOL_ALPHA, MOCK_POOL_BETA];
}

/** Get all 8 preset resource entries. */
export function getMockResources(): ResourcesEntry[] {
  return RESOURCE_SEEDS.map(buildResourceEntry);
}

/**
 * Get preset resources filtered to pools whose pool_platform_labels
 * include at least one of the requested pool names.
 */
export function getMockResourcesForPools(pools: string[]): ResourcesEntry[] {
  const poolSet = new Set(pools);
  return getMockResources().filter((resource) =>
    Object.keys(resource.pool_platform_labels).some((pool) => poolSet.has(pool)),
  );
}
