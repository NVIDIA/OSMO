/**
 * Copyright (c) 2025, NVIDIA CORPORATION. All rights reserved.
 *
 * NVIDIA CORPORATION and its licensors retain all intellectual property
 * and proprietary rights in and to this software, related documentation
 * and any modifications thereto. Any use, reproduction, disclosure or
 * distribution of this software and related documentation without an express
 * license agreement from NVIDIA CORPORATION is strictly prohibited.
 */

import type { SearchField } from "@/components/ui/smart-search";
import type { Pool } from "@/lib/api/adapter";

/** Base search fields that don't require additional context */
const BASE_POOL_SEARCH_FIELDS: SearchField<Pool>[] = [
  {
    id: "pool",
    label: "Pool",
    hint: "Pool",
    prefix: "pool:",
    getValues: (pools) => pools.map((p) => p.name).slice(0, 20),
    match: (pool, value) => pool.name.toLowerCase().includes(value.toLowerCase()),
  },
  {
    id: "platform",
    label: "Platform",
    hint: "Platform",
    prefix: "platform:",
    getValues: (pools) => [...new Set(pools.flatMap((p) => p.platforms))].sort(),
    match: (pool, value) => pool.platforms.some((p) => p.toLowerCase().includes(value.toLowerCase())),
  },
  {
    id: "backend",
    label: "Backend",
    hint: "Backend",
    prefix: "backend:",
    getValues: (pools) => [...new Set(pools.map((p) => p.backend))].sort(),
    match: (pool, value) => pool.backend.toLowerCase().includes(value.toLowerCase()),
  },
  {
    id: "description",
    label: "Description",
    hint: "Description text",
    prefix: "description:",
    // Description field: no autocomplete values, only free-text substring search
    getValues: () => [],
    match: (pool, value) => pool.description.toLowerCase().includes(value.toLowerCase()),
    // Mark as free-text only - no dropdown suggestions
    freeTextOnly: true,
  },
];

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
    hint: "Pools sharing capacity",
    prefix: "shared:",
    // Only show pools that are actually shared
    getValues: () => sharedPoolNames,
    // Match if pool is in the same sharing group as the filter value
    match: (pool, value) => {
      const group = poolToGroup.get(value);
      if (!group) return false;
      return group.includes(pool.name);
    },
    // Requires valid value - no free text allowed
    requiresValidValue: true,
  };

  return [...BASE_POOL_SEARCH_FIELDS, sharedField];
}

/** Default search fields without sharing context (for backwards compatibility) */
export const POOL_SEARCH_FIELDS: SearchField<Pool>[] = BASE_POOL_SEARCH_FIELDS;
