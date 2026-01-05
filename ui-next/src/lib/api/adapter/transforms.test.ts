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

import { describe, it, expect } from "vitest";
import {
  transformPoolsResponse,
  transformPoolDetail,
  transformResourcesResponse,
  transformAllResourcesResponse,
  transformVersionResponse,
} from "./transforms";
import { PoolStatus, BackendResourceType } from "../generated";

// =============================================================================
// Test fixtures - minimal data to verify transforms
// =============================================================================

const mockPoolResponse = {
  node_sets: [
    {
      pools: [
        {
          name: "pool-alpha",
          description: "Alpha pool",
          status: "ONLINE",
          resource_usage: {
            quota_used: "10",
            quota_free: "90",
            quota_limit: "100",
            total_usage: "25",
            total_capacity: "200",
            total_free: "175",
          },
          platforms: {
            dgx: {
              description: "DGX platform",
              host_network_allowed: true,
              privileged_allowed: false,
              allowed_mounts: ["/data"],
              default_mounts: ["/home"],
            },
          },
          backend: "k8s",
          default_exec_timeout: "4h",
          max_exec_timeout: "24h",
          default_queue_timeout: "15m",
          max_queue_timeout: "1h",
          default_exit_actions: {
            "137": "retry",
            "139": "fail",
            "255": "retry_different_node",
          },
        },
        {
          name: "pool-beta",
          description: "Beta pool",
          status: "OFFLINE",
          resource_usage: {
            quota_used: 5,
            quota_free: 15,
            quota_limit: 20,
          },
          platforms: {},
          backend: "k8s",
        },
      ],
    },
  ],
};

const mockResourceResponse = {
  resources: [
    {
      hostname: "node-001.example.com",
      resource_type: "SHARED",
      backend: "k8s",
      conditions: ["Ready", "SchedulingEnabled"],
      exposed_fields: {
        node: "node-001",
        "pool/platform": ["pool-alpha/dgx", "pool-alpha/base"],
      },
      allocatable_fields: {
        gpu: 8,
        cpu: 128,
        memory: 536870912, // 512 GiB in KiB (512 * 1024 * 1024)
        storage: 1099511627776, // 1 TiB in bytes (1024 * 1024 * 1024 * 1024)
      },
      usage_fields: {
        gpu: 4,
        cpu: 64,
        memory: 268435456, // 256 GiB in KiB (256 * 1024 * 1024)
        storage: 549755813888, // 512 GiB in bytes (512 * 1024 * 1024 * 1024)
      },
      pool_platform_labels: {
        "pool-alpha": ["dgx", "base"],
      },
    },
    {
      hostname: "node-002.example.com",
      resource_type: "RESERVED",
      backend: "k8s",
      conditions: ["Ready"],
      exposed_fields: {
        node: "node-002",
        "pool/platform": ["pool-alpha/dgx"],
      },
      allocatable_fields: {
        gpu: 4,
        cpu: 64,
      },
      usage_fields: {
        gpu: 0,
        cpu: 0,
      },
      pool_platform_labels: {
        "pool-alpha": ["dgx"],
      },
    },
  ],
};

const mockAllResourcesResponse = {
  resources: [
    {
      hostname: "node-001.example.com",
      resource_type: "SHARED",
      backend: "k8s",
      conditions: ["Ready"],
      exposed_fields: {
        node: "node-001",
        "pool/platform": ["pool-alpha/dgx", "pool-beta/base"],
      },
      allocatable_fields: { gpu: 8 },
      usage_fields: { gpu: 2 },
      pool_platform_labels: {},
    },
    {
      hostname: "node-003.example.com",
      resource_type: "EXCLUSIVE",
      backend: "slurm",
      conditions: [],
      exposed_fields: {
        node: "node-003",
        "pool/platform": ["pool-gamma/hpc"],
      },
      allocatable_fields: { gpu: 16 },
      usage_fields: { gpu: 16 },
      pool_platform_labels: {},
    },
  ],
};

// =============================================================================
// Pool Transform Tests
// =============================================================================

describe("transformPoolsResponse", () => {
  it("transforms empty response", () => {
    expect(transformPoolsResponse(null)).toEqual({ pools: [], sharingGroups: [] });
    expect(transformPoolsResponse(undefined)).toEqual({ pools: [], sharingGroups: [] });
    expect(transformPoolsResponse({})).toEqual({ pools: [], sharingGroups: [] });
  });

  it("transforms pools from node_sets", () => {
    const result = transformPoolsResponse(mockPoolResponse);
    expect(result.pools).toHaveLength(2);
  });

  it("transforms pool name and description", () => {
    const result = transformPoolsResponse(mockPoolResponse);
    expect(result.pools[0].name).toBe("pool-alpha");
    expect(result.pools[0].description).toBe("Alpha pool");
  });

  it("transforms pool status to PoolStatus enum", () => {
    const result = transformPoolsResponse(mockPoolResponse);
    expect(result.pools[0].status).toBe(PoolStatus.ONLINE);
    expect(result.pools[1].status).toBe(PoolStatus.OFFLINE);
  });

  it("parses string quota values to numbers", () => {
    const result = transformPoolsResponse(mockPoolResponse);
    const quota = result.pools[0].quota;
    expect(quota.used).toBe(10);
    expect(quota.free).toBe(90);
    expect(quota.limit).toBe(100);
    expect(quota.totalUsage).toBe(25);
    expect(quota.totalCapacity).toBe(200);
    expect(quota.totalFree).toBe(175);
  });

  it("handles number quota values directly", () => {
    const result = transformPoolsResponse(mockPoolResponse);
    const quota = result.pools[1].quota;
    expect(quota.used).toBe(5);
    expect(quota.free).toBe(15);
    expect(quota.limit).toBe(20);
  });

  it("extracts platform names", () => {
    const result = transformPoolsResponse(mockPoolResponse);
    expect(result.pools[0].platforms).toEqual(["dgx"]);
    expect(result.pools[1].platforms).toEqual([]);
  });

  it("transforms platform configs", () => {
    const result = transformPoolsResponse(mockPoolResponse);
    const dgxConfig = result.pools[0].platformConfigs["dgx"];
    expect(dgxConfig.description).toBe("DGX platform");
    expect(dgxConfig.hostNetworkAllowed).toBe(true);
    expect(dgxConfig.privilegedAllowed).toBe(false);
    expect(dgxConfig.allowedMounts).toEqual(["/data"]);
    expect(dgxConfig.defaultMounts).toEqual(["/home"]);
  });

  it("transforms timeout configurations", () => {
    const result = transformPoolsResponse(mockPoolResponse);
    expect(result.pools[0].timeouts.defaultExec).toBe("4h");
    expect(result.pools[0].timeouts.maxExec).toBe("24h");
    expect(result.pools[0].timeouts.defaultQueue).toBe("15m");
    expect(result.pools[0].timeouts.maxQueue).toBe("1h");
  });

  it("transforms default exit actions", () => {
    const result = transformPoolsResponse(mockPoolResponse);
    expect(result.pools[0].defaultExitActions).toEqual({
      "137": "retry",
      "139": "fail",
      "255": "retry_different_node",
    });
  });

  it("handles missing exit actions gracefully", () => {
    const result = transformPoolsResponse(mockPoolResponse);
    expect(result.pools[1].defaultExitActions).toEqual({});
  });
});

describe("transformPoolDetail", () => {
  it("returns null for missing pool", () => {
    expect(transformPoolDetail(mockPoolResponse, "nonexistent")).toBeNull();
  });

  it("finds and transforms matching pool", () => {
    const result = transformPoolDetail(mockPoolResponse, "pool-alpha");
    expect(result).not.toBeNull();
    expect(result?.name).toBe("pool-alpha");
    expect(result?.status).toBe(PoolStatus.ONLINE);
  });

  it("finds pool by exact name match", () => {
    const result = transformPoolDetail(mockPoolResponse, "pool-beta");
    expect(result?.name).toBe("pool-beta");
    expect(result?.status).toBe(PoolStatus.OFFLINE);
  });
});

// =============================================================================
// Resource Transform Tests
// =============================================================================

describe("transformResourcesResponse", () => {
  it("transforms empty response", () => {
    expect(transformResourcesResponse(null, "pool-alpha")).toEqual({
      resources: [],
      platforms: [],
    });
  });

  it("filters resources by pool name", () => {
    const result = transformResourcesResponse(mockResourceResponse, "pool-alpha");
    expect(result.resources).toHaveLength(3); // node-001 appears twice (dgx + base), node-002 once
  });

  it("transforms resource name from exposed_fields.node", () => {
    const result = transformResourcesResponse(mockResourceResponse, "pool-alpha");
    expect(result.resources[0].name).toBe("node-001");
    expect(result.resources[0].hostname).toBe("node-001.example.com");
  });

  it("transforms resource type to enum", () => {
    const result = transformResourcesResponse(mockResourceResponse, "pool-alpha");
    const sharedResource = result.resources.find((r) => r.hostname === "node-001.example.com");
    const reservedResource = result.resources.find((r) => r.hostname === "node-002.example.com");
    expect(sharedResource?.resourceType).toBe(BackendResourceType.SHARED);
    expect(reservedResource?.resourceType).toBe(BackendResourceType.RESERVED);
  });

  it("extracts platforms for the pool", () => {
    const result = transformResourcesResponse(mockResourceResponse, "pool-alpha");
    expect(result.platforms).toEqual(["base", "dgx"]);
  });

  it("converts memory from KiB to GiB", () => {
    const result = transformResourcesResponse(mockResourceResponse, "pool-alpha");
    const resource = result.resources[0];
    // 549755813888 KiB = 512 GiB
    expect(resource.memory.total).toBe(512);
    // 274877906944 KiB = 256 GiB
    expect(resource.memory.used).toBe(256);
  });

  it("converts storage from bytes to GiB", () => {
    const result = transformResourcesResponse(mockResourceResponse, "pool-alpha");
    const resource = result.resources[0];
    // 1099511627776 bytes = 1024 GiB
    expect(resource.storage.total).toBe(1024);
    // 549755813888 bytes = 512 GiB
    expect(resource.storage.used).toBe(512);
  });

  it("preserves GPU and CPU values without conversion", () => {
    const result = transformResourcesResponse(mockResourceResponse, "pool-alpha");
    const resource = result.resources[0];
    expect(resource.gpu.total).toBe(8);
    expect(resource.gpu.used).toBe(4);
    expect(resource.cpu.total).toBe(128);
    expect(resource.cpu.used).toBe(64);
  });

  it("parses pool memberships from pool_platform_labels", () => {
    const result = transformResourcesResponse(mockResourceResponse, "pool-alpha");
    const resource = result.resources[0];
    expect(resource.poolMemberships).toEqual([
      { pool: "pool-alpha", platform: "dgx" },
      { pool: "pool-alpha", platform: "base" },
    ]);
  });
});

// =============================================================================
// All Resources Transform Tests (Cross-Pool)
// =============================================================================

describe("transformAllResourcesResponse", () => {
  it("transforms empty response", () => {
    expect(transformAllResourcesResponse(null)).toEqual({
      resources: [],
      pools: [],
      platforms: [],
    });
  });

  it("returns one entry per resource (not per pool)", () => {
    const result = transformAllResourcesResponse(mockAllResourcesResponse);
    expect(result.resources).toHaveLength(2);
  });

  it("extracts all unique pools across resources", () => {
    const result = transformAllResourcesResponse(mockAllResourcesResponse);
    expect(result.pools).toEqual(["pool-alpha", "pool-beta", "pool-gamma"]);
  });

  it("extracts all unique platforms across resources", () => {
    const result = transformAllResourcesResponse(mockAllResourcesResponse);
    expect(result.platforms).toEqual(["base", "dgx", "hpc"]);
  });

  it("includes all pool memberships per resource", () => {
    const result = transformAllResourcesResponse(mockAllResourcesResponse);
    const resource = result.resources[0];
    expect(resource.poolMemberships).toEqual([
      { pool: "pool-alpha", platform: "dgx" },
      { pool: "pool-beta", platform: "base" },
    ]);
  });

  it("uses first platform as primary platform", () => {
    const result = transformAllResourcesResponse(mockAllResourcesResponse);
    expect(result.resources[0].platform).toBe("dgx");
    expect(result.resources[1].platform).toBe("hpc");
  });

  it("skips resources with no pool memberships", () => {
    const responseWithOrphan = {
      resources: [
        ...mockAllResourcesResponse.resources,
        {
          hostname: "orphan-node",
          resource_type: "SHARED",
          exposed_fields: { node: "orphan", "pool/platform": [] },
          allocatable_fields: {},
          usage_fields: {},
        },
      ],
    };
    const result = transformAllResourcesResponse(responseWithOrphan);
    expect(result.resources).toHaveLength(2); // Orphan excluded
  });
});

// =============================================================================
// Version Transform Tests
// =============================================================================

describe("transformVersionResponse", () => {
  it("transforms null to null", () => {
    expect(transformVersionResponse(null)).toBeNull();
    expect(transformVersionResponse(undefined)).toBeNull();
  });

  it("transforms version object", () => {
    const result = transformVersionResponse({
      major: 1,
      minor: 2,
      revision: 3,
      hash: "abc123def456",
    });
    expect(result).toEqual({
      major: "1",
      minor: "2",
      revision: "3",
      hash: "abc123def456",
    });
  });

  it("handles missing hash", () => {
    const result = transformVersionResponse({
      major: 1,
      minor: 0,
      revision: 0,
    });
    expect(result?.hash).toBeUndefined();
  });

  it("defaults missing fields to '0'", () => {
    const result = transformVersionResponse({});
    expect(result).toEqual({
      major: "0",
      minor: "0",
      revision: "0",
      hash: undefined,
    });
  });
});

// =============================================================================
// Edge Cases & Error Handling
// =============================================================================

describe("edge cases", () => {
  it("handles missing fields gracefully", () => {
    const minimalPool = {
      node_sets: [
        {
          pools: [
            {
              // Only name, everything else missing
              name: "minimal-pool",
            },
          ],
        },
      ],
    };
    const result = transformPoolsResponse(minimalPool);
    expect(result.pools[0].name).toBe("minimal-pool");
    expect(result.pools[0].description).toBe("");
    expect(result.pools[0].status).toBe(PoolStatus.ONLINE); // Default
    expect(result.pools[0].platforms).toEqual([]);
  });

  it("handles NaN in string number parsing", () => {
    const poolWithBadQuota = {
      node_sets: [
        {
          pools: [
            {
              name: "bad-quota-pool",
              resource_usage: {
                quota_used: "not-a-number",
                quota_free: "",
                quota_limit: null,
              },
            },
          ],
        },
      ],
    };
    const result = transformPoolsResponse(poolWithBadQuota);
    expect(result.pools[0].quota.used).toBe(0);
    expect(result.pools[0].quota.free).toBe(0);
    expect(result.pools[0].quota.limit).toBe(0);
  });

  it("handles zero values in unit conversion", () => {
    const resourceWithZeros = {
      resources: [
        {
          hostname: "empty-node",
          resource_type: "SHARED",
          exposed_fields: {
            node: "empty",
            "pool/platform": ["pool/base"],
          },
          allocatable_fields: {
            memory: 0,
            storage: 0,
          },
          usage_fields: {
            memory: 0,
            storage: 0,
          },
        },
      ],
    };
    const result = transformResourcesResponse(resourceWithZeros, "pool");
    expect(result.resources[0].memory.total).toBe(0);
    expect(result.resources[0].storage.total).toBe(0);
  });
});
