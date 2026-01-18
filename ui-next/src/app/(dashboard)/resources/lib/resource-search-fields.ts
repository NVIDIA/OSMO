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

import type { SearchField } from "@/components/filter-bar";
import type { Resource } from "@/lib/api/adapter";
import { BackendResourceType } from "@/lib/api/generated";
import { createNumericSearchFieldPair } from "@/lib/filter-utils";

// ============================================================================
// Base Search Fields
// ============================================================================

const BASE_RESOURCE_SEARCH_FIELDS: SearchField<Resource>[] = [
  {
    id: "name",
    label: "Name",
    hint: "resource name",
    prefix: "name:",
    freeFormHint: "Type any name, press Enter",
    getValues: () => [],
    match: (resource, value) => resource.name.toLowerCase().includes(value.toLowerCase()),
  },
  {
    id: "type",
    label: "Type",
    hint: "allocation type",
    prefix: "type:",
    getValues: () => Object.values(BackendResourceType),
    exhaustive: true,
    validate: (value) => {
      const validTypes = Object.values(BackendResourceType).map((t) => t.toLowerCase());
      if (!validTypes.includes(value.toLowerCase())) {
        return `Must be one of: ${Object.values(BackendResourceType).join(", ")}`;
      }
      return true;
    },
    match: (resource, value) => resource.resourceType.toLowerCase() === value.toLowerCase(),
  },
  {
    id: "platform",
    label: "Platform",
    hint: "platform name",
    prefix: "platform:",
    freeFormHint: "Type any platform, press Enter",
    getValues: (resources) => [...new Set(resources.map((r) => r.platform))].sort(),
    match: (resource, value) => resource.platform.toLowerCase() === value.toLowerCase(),
  },
  {
    id: "pool",
    label: "Pool",
    hint: "pool membership",
    prefix: "pool:",
    freeFormHint: "Type any pool, press Enter",
    getValues: (resources) => [...new Set(resources.flatMap((r) => r.poolMemberships.map((m) => m.pool)))].sort(),
    // Case-sensitive exact match for cross-linking from pools page
    match: (resource, value) => resource.poolMemberships.some((m) => m.pool === value),
  },
  {
    id: "backend",
    label: "Backend",
    hint: "backend cluster",
    prefix: "backend:",
    freeFormHint: "Type any backend, press Enter",
    getValues: (resources) => [...new Set(resources.map((r) => r.backend))].sort(),
    match: (resource, value) => resource.backend.toLowerCase() === value.toLowerCase(),
  },
  {
    id: "hostname",
    label: "Hostname",
    hint: "hostname",
    prefix: "hostname:",
    freeFormHint: "Type any hostname, press Enter",
    getValues: () => [],
    match: (resource, value) => resource.hostname.toLowerCase().includes(value.toLowerCase()),
  },
];

// ============================================================================
// Numeric Search Fields
// ============================================================================

/** GPU free/used fields */
const [gpuFree, gpuUsed] = createNumericSearchFieldPair<Resource>({
  category: "gpu",
  label: "GPU",
  hintFree: "available GPUs",
  hintUsed: "GPU utilization",
  getFree: (r) => r.gpu.total - r.gpu.used,
  getUsed: (r) => r.gpu.used,
  getMax: (r) => r.gpu.total,
});

/** CPU free/used fields */
const [cpuFree, cpuUsed] = createNumericSearchFieldPair<Resource>({
  category: "cpu",
  label: "CPU",
  hintFree: "available CPUs",
  hintUsed: "CPU utilization",
  getFree: (r) => r.cpu.total - r.cpu.used,
  getUsed: (r) => r.cpu.used,
  getMax: (r) => r.cpu.total,
});

/** Memory free/used fields (percentage only) */
const [memoryFree, memoryUsed] = createNumericSearchFieldPair<Resource>({
  category: "memory",
  label: "Memory",
  hintFree: "available memory",
  hintUsed: "memory utilization",
  getFree: (r) => r.memory.total - r.memory.used,
  getUsed: (r) => r.memory.used,
  getMax: (r) => r.memory.total,
  validateOptions: { allowDiscrete: false },
});

const NUMERIC_RESOURCE_SEARCH_FIELDS: SearchField<Resource>[] = [
  gpuFree,
  gpuUsed,
  cpuFree,
  cpuUsed,
  memoryFree,
  memoryUsed,
];

// ============================================================================
// Exports
// ============================================================================

/**
 * Pre-built resource search fields (frozen to prevent accidental mutation).
 * Use this constant directly instead of calling createResourceSearchFields().
 */
export const RESOURCE_SEARCH_FIELDS: readonly SearchField<Resource>[] = Object.freeze([
  ...BASE_RESOURCE_SEARCH_FIELDS,
  ...NUMERIC_RESOURCE_SEARCH_FIELDS,
]);

/**
 * Create resource search fields.
 * @deprecated Use RESOURCE_SEARCH_FIELDS constant instead
 */
export function createResourceSearchFields(): SearchField<Resource>[] {
  return [...RESOURCE_SEARCH_FIELDS];
}

/** Re-export numeric filter utilities for testing */
export { parseNumericFilter, validateNumericFilter, compareNumeric } from "@/lib/filter-utils";
