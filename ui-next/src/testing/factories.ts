/**
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION. All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Test Data Factories
 *
 * Factory functions for creating test data with sensible defaults.
 * Supports partial overrides for flexible test scenarios.
 *
 * ## Usage Pattern
 *
 * ```tsx
 * // Create with defaults
 * const pool = createMockPool();
 *
 * // Create with overrides
 * const offlinePool = createMockPool({ status: 'OFFLINE', name: 'offline-pool' });
 *
 * // Create multiple
 * const pools = [
 *   createMockPool({ name: 'pool-1' }),
 *   createMockPool({ name: 'pool-2', status: 'MAINTENANCE' }),
 * ];
 * ```
 */

import type { Pool, Resource } from "@/lib/api/adapter/types";
import { PoolStatus, WorkflowStatus, WorkflowPriority } from "@/lib/api/generated";

// =============================================================================
// Counter for unique IDs
// =============================================================================

let idCounter = 0;

/**
 * Reset the ID counter. Call in beforeEach for consistent test results.
 */
export function resetIdCounter(): void {
  idCounter = 0;
}

/**
 * Generate a unique ID for test entities.
 */
function uniqueId(prefix: string): string {
  return `${prefix}-${++idCounter}`;
}

// =============================================================================
// Pool Factory
// =============================================================================

/**
 * Create a mock Pool with sensible defaults.
 *
 * @param overrides - Partial Pool to override defaults
 * @returns Complete Pool object
 *
 * @example
 * ```tsx
 * const pool = createMockPool({ name: 'my-pool', status: 'ONLINE' });
 * ```
 */
export function createMockPool(overrides: Partial<Pool> = {}): Pool {
  const name = overrides.name ?? uniqueId("test-pool");

  return {
    name,
    description: `Description for ${name}`,
    status: PoolStatus.ONLINE,
    quota: {
      used: 2,
      free: 6,
      limit: 8,
      totalUsage: 4,
      totalCapacity: 16,
      totalFree: 12,
    },
    platforms: ["dgx"],
    platformConfigs: {
      dgx: {
        hostNetworkAllowed: false,
        privilegedAllowed: false,
        allowedMounts: [],
        defaultMounts: [],
      },
    },
    backend: "slurm",
    defaultPlatform: "dgx",
    gpuResources: {
      guarantee: null,
      maximum: null,
      weight: null,
    },
    timeouts: {
      defaultExec: "24h",
      maxExec: null,
      defaultQueue: null,
      maxQueue: null,
    },
    defaultExitActions: {},
    ...overrides,
  };
}

/**
 * Create multiple mock pools.
 *
 * @param count - Number of pools to create
 * @param overridesPerPool - Function to generate overrides for each pool
 * @returns Array of Pool objects
 *
 * @example
 * ```tsx
 * const pools = createMockPools(3, (i) => ({ name: `pool-${i}` }));
 * ```
 */
export function createMockPools(count: number, overridesPerPool?: (index: number) => Partial<Pool>): Pool[] {
  return Array.from({ length: count }, (_, i) => createMockPool(overridesPerPool?.(i)));
}

// =============================================================================
// Resource Factory
// =============================================================================

/**
 * Create a mock Resource with sensible defaults.
 *
 * @param overrides - Partial Resource to override defaults
 * @returns Complete Resource object
 *
 * @example
 * ```tsx
 * const resource = createMockResource({ name: 'node-01' });
 * ```
 */
export function createMockResource(overrides: Partial<Resource> = {}): Resource {
  const name = overrides.name ?? uniqueId("test-node");

  return {
    hostname: `${name}.cluster.local`,
    name,
    platform: "dgx",
    resourceType: "RESERVED",
    backend: "slurm",
    gpu: { used: 2, total: 8 },
    cpu: { used: 4, total: 32 },
    memory: { used: 16, total: 128 },
    storage: { used: 100, total: 1000 },
    conditions: [],
    poolMemberships: [{ pool: "default-pool", platform: "dgx" }],
    ...overrides,
  };
}

/**
 * Create multiple mock resources.
 *
 * @param count - Number of resources to create
 * @param overridesPerResource - Function to generate overrides for each resource
 * @returns Array of Resource objects
 */
export function createMockResources(
  count: number,
  overridesPerResource?: (index: number) => Partial<Resource>,
): Resource[] {
  return Array.from({ length: count }, (_, i) => createMockResource(overridesPerResource?.(i)));
}

// =============================================================================
// Workflow Factory
// =============================================================================

export interface MockWorkflow {
  name: string;
  status: string;
  user: string;
  pool: string;
  priority: string;
  submit_time: string;
  start_time?: string;
  end_time?: string;
}

/**
 * Create a mock Workflow with sensible defaults.
 *
 * @param overrides - Partial workflow to override defaults
 * @returns Complete workflow object
 */
export function createMockWorkflow(overrides: Partial<MockWorkflow> = {}): MockWorkflow {
  const name = overrides.name ?? uniqueId("test-workflow");

  return {
    name,
    status: WorkflowStatus.RUNNING,
    user: "test-user",
    pool: "default-pool",
    priority: WorkflowPriority.NORMAL,
    submit_time: new Date().toISOString(),
    ...overrides,
  };
}

/**
 * Create multiple mock workflows.
 */
export function createMockWorkflows(
  count: number,
  overridesPerWorkflow?: (index: number) => Partial<MockWorkflow>,
): MockWorkflow[] {
  return Array.from({ length: count }, (_, i) => createMockWorkflow(overridesPerWorkflow?.(i)));
}

// =============================================================================
// Search Chip Factory
// =============================================================================

export interface MockSearchChip {
  field: string;
  value: string;
  label?: string;
}

/**
 * Create a mock search chip.
 */
export function createMockChip(field: string, value: string, label?: string): MockSearchChip {
  return {
    field,
    value,
    label: label ?? `${field}: ${value}`,
  };
}

/**
 * Create multiple chips from a map of field -> values.
 */
export function createMockChips(fieldValues: Record<string, string[]>): MockSearchChip[] {
  return Object.entries(fieldValues).flatMap(([field, values]) => values.map((value) => createMockChip(field, value)));
}
