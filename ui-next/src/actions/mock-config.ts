// Copyright (c) 2026, NVIDIA CORPORATION. All rights reserved.
//
// NVIDIA CORPORATION and its licensors retain all intellectual property
// and proprietary rights in and to this software, related documentation
// and any modifications thereto. Any use, reproduction, disclosure or
// distribution of this software and related documentation without an express
// license agreement from NVIDIA CORPORATION is strictly prohibited.

"use server";

/**
 * Server Actions for Mock Configuration
 *
 * These actions run in the same Node.js process as the MSW server,
 * allowing direct manipulation of mock data generators.
 *
 * IMPORTANT: This file is only imported by MockProvider.tsx, which is
 * aliased to a no-op stub in production. Therefore, this file is never
 * part of the production bundle.
 *
 * Usage (from browser console):
 *   __mockConfig.setWorkflowTotal(100000)
 *   __mockConfig.getVolumes()
 */

import type { MockVolumes } from "./mock-config.types";

/**
 * Set mock data volumes on the server.
 * Changes take effect immediately for subsequent API requests.
 */
export async function setMockVolumes(volumes: Partial<MockVolumes>): Promise<MockVolumes> {
  // Dynamic imports ensure generators are only loaded when this action runs
  const [wf, pool, resource, bucket, dataset] = await Promise.all([
    import("@/mocks/generators/workflow-generator"),
    import("@/mocks/generators/pool-generator"),
    import("@/mocks/generators/resource-generator"),
    import("@/mocks/generators/bucket-generator"),
    import("@/mocks/generators/dataset-generator"),
  ]);

  if (volumes.workflows !== undefined) {
    wf.setWorkflowTotal(volumes.workflows);
  }
  if (volumes.pools !== undefined) {
    pool.setPoolTotal(volumes.pools);
  }
  if (volumes.resourcesPerPool !== undefined) {
    resource.setResourcePerPool(volumes.resourcesPerPool);
  }
  if (volumes.resourcesGlobal !== undefined) {
    resource.setResourceTotalGlobal(volumes.resourcesGlobal);
  }
  if (volumes.buckets !== undefined) {
    bucket.setBucketTotal(volumes.buckets);
  }
  if (volumes.datasets !== undefined) {
    dataset.setDatasetTotal(volumes.datasets);
  }

  // Return current volumes
  return {
    workflows: wf.getWorkflowTotal(),
    pools: pool.getPoolTotal(),
    resourcesPerPool: resource.getResourcePerPool(),
    resourcesGlobal: resource.getResourceTotalGlobal(),
    buckets: bucket.getBucketTotal(),
    datasets: dataset.getDatasetTotal(),
  };
}

/**
 * Get current mock data volumes from the server.
 */
export async function getMockVolumes(): Promise<MockVolumes> {
  const [wf, pool, resource, bucket, dataset] = await Promise.all([
    import("@/mocks/generators/workflow-generator"),
    import("@/mocks/generators/pool-generator"),
    import("@/mocks/generators/resource-generator"),
    import("@/mocks/generators/bucket-generator"),
    import("@/mocks/generators/dataset-generator"),
  ]);

  return {
    workflows: wf.getWorkflowTotal(),
    pools: pool.getPoolTotal(),
    resourcesPerPool: resource.getResourcePerPool(),
    resourcesGlobal: resource.getResourceTotalGlobal(),
    buckets: bucket.getBucketTotal(),
    datasets: dataset.getDatasetTotal(),
  };
}
