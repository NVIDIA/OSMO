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

import type { SearchField } from "@/components/filter-bar/lib/types";
import type { Pool } from "@/lib/api/adapter/types";
import { createNumericSearchFieldPair } from "@/lib/filter-utils";

// ============================================================================
// Base Search Fields
// ============================================================================

/** Base search fields that don't require additional context */
const BASE_POOL_SEARCH_FIELDS: SearchField<Pool>[] = [
  {
    id: "pool",
    label: "Pool",
    hint: "pool name",
    prefix: "pool:",
    freeFormHint: "Type any pool, press Enter",
    getValues: (pools) => pools.map((p) => p.name).slice(0, 20),
    match: (pool, value) => pool.name.toLowerCase().includes(value.toLowerCase()),
  },
  // Note: status filter is handled via presets in the toolbar, not as a typed field
  {
    id: "platform",
    label: "Platform",
    hint: "platform name",
    prefix: "platform:",
    freeFormHint: "Type any platform, press Enter",
    getValues: (pools) => [...new Set(pools.flatMap((p) => p.platforms))].sort(),
    match: (pool, value) => pool.platforms.some((p) => p.toLowerCase().includes(value.toLowerCase())),
  },
  {
    id: "backend",
    label: "Backend",
    hint: "backend name",
    prefix: "backend:",
    freeFormHint: "Type any backend, press Enter",
    getValues: (pools) => [...new Set(pools.map((p) => p.backend))].sort(),
    match: (pool, value) => pool.backend.toLowerCase().includes(value.toLowerCase()),
  },
  {
    id: "description",
    label: "Description",
    hint: "description text",
    prefix: "description:",
    freeFormHint: "Type any text, press Enter",
    getValues: () => [],
    match: (pool, value) => pool.description.toLowerCase().includes(value.toLowerCase()),
  },
];

// ============================================================================
// Numeric Search Fields (Quota & Capacity)
// ============================================================================

/** Quota and capacity fields with free/used variants */
const [quotaFree, quotaUsed] = createNumericSearchFieldPair<Pool>({
  category: "quota",
  label: "Quota",
  hintFree: "available guaranteed GPUs",
  hintUsed: "quota consumption",
  getFree: (p) => p.quota.free,
  getUsed: (p) => p.quota.used,
  getMax: (p) => p.quota.limit,
});

const [capacityFree, capacityUsed] = createNumericSearchFieldPair<Pool>({
  category: "capacity",
  label: "Capacity",
  hintFree: "total GPUs available",
  hintUsed: "pool consumption",
  getFree: (p) => p.quota.totalFree,
  getUsed: (p) => p.quota.totalUsage,
  getMax: (p) => p.quota.totalCapacity,
});

const NUMERIC_POOL_SEARCH_FIELDS: SearchField<Pool>[] = [quotaFree, quotaUsed, capacityFree, capacityUsed];

// ============================================================================
// Exports
// ============================================================================

/**
 * Create pool search fields with the shared filter.
 * The shared filter requires sharingGroups context to work.
 */
export function createPoolSearchFields(sharingGroups: string[][]): SearchField<Pool>[] {
  // Build a map of pool name -> sharing group for fast lookup
  const poolToGroup = new Map<string, string[]>();
  for (const group of sharingGroups) {
    if (group.length > 1) {
      for (const poolName of group) {
        poolToGroup.set(poolName, group);
      }
    }
  }

  // Get all shared pool names (pools that are part of a sharing group)
  const sharedPoolNames = [...poolToGroup.keys()].sort();

  const sharedField: SearchField<Pool> = {
    id: "shared",
    label: "Shared",
    hint: "pools sharing capacity",
    prefix: "shared:",
    freeFormHint: "Type any pool, press Enter",
    // Show pools that are in sharing groups (from loaded data)
    // Note: suggestions are non-exhaustive with backend filtering
    getValues: () => sharedPoolNames,
    // Match if pool is in the same sharing group as the filter value
    match: (pool, value) => {
      const group = poolToGroup.get(value);
      if (!group) return false;
      return group.includes(pool.name);
    },
  };

  return [...BASE_POOL_SEARCH_FIELDS, sharedField, ...NUMERIC_POOL_SEARCH_FIELDS];
}

/** Re-export numeric filter utilities for testing */
export { parseNumericFilter, validateNumericFilter, compareNumeric } from "@/lib/filter-utils";
