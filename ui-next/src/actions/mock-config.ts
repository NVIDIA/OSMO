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
  // Dynamic import ensures generators are only loaded when this action runs
  const generators = await import("@/mocks/generators");

  if (volumes.workflows !== undefined) {
    generators.setWorkflowTotal(volumes.workflows);
  }
  if (volumes.pools !== undefined) {
    generators.setPoolTotal(volumes.pools);
  }
  if (volumes.resourcesPerPool !== undefined) {
    generators.setResourcePerPool(volumes.resourcesPerPool);
  }
  if (volumes.resourcesGlobal !== undefined) {
    generators.setResourceTotalGlobal(volumes.resourcesGlobal);
  }
  if (volumes.buckets !== undefined) {
    generators.setBucketTotal(volumes.buckets);
  }
  if (volumes.datasets !== undefined) {
    generators.setDatasetTotal(volumes.datasets);
  }

  // Return current volumes
  return {
    workflows: generators.getWorkflowTotal(),
    pools: generators.getPoolTotal(),
    resourcesPerPool: generators.getResourcePerPool(),
    resourcesGlobal: generators.getResourceTotalGlobal(),
    buckets: generators.getBucketTotal(),
    datasets: generators.getDatasetTotal(),
  };
}

/**
 * Get current mock data volumes from the server.
 */
export async function getMockVolumes(): Promise<MockVolumes> {
  const generators = await import("@/mocks/generators");

  return {
    workflows: generators.getWorkflowTotal(),
    pools: generators.getPoolTotal(),
    resourcesPerPool: generators.getResourcePerPool(),
    resourcesGlobal: generators.getResourceTotalGlobal(),
    buckets: generators.getBucketTotal(),
    datasets: generators.getDatasetTotal(),
  };
}
