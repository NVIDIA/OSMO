/**
 * Copyright (c) 2025, NVIDIA CORPORATION. All rights reserved.
 *
 * NVIDIA CORPORATION and its licensors retain all intellectual property
 * and proprietary rights in and to this software, related documentation
 * and any modifications thereto. Any use, reproduction, disclosure or
 * distribution of this software and related documentation without an express
 * license agreement from NVIDIA CORPORATION is strictly prohibited.
 */

/**
 * Pool Search Field Definitions
 *
 * Defines searchable fields for the pools smart search:
 * - Field prefixes (e.g., "status:", "platform:")
 * - Autocomplete value extraction
 * - Match functions for filtering
 */

import type { SearchField } from "@/components/ui/smart-search";
import type { Pool } from "@/lib/api/adapter";

/**
 * Search fields for the pools table.
 */
export const POOL_SEARCH_FIELDS: SearchField<Pool>[] = [
  {
    id: "name",
    label: "Name",
    prefix: "name:",
    getValues: (pools) => pools.map((p) => p.name).slice(0, 20),
    match: (pool, value) => pool.name.toLowerCase().includes(value.toLowerCase()),
  },
  {
    id: "status",
    label: "Status",
    prefix: "status:",
    getValues: () => ["online", "maintenance", "offline"],
    match: (pool, value) => pool.status.toLowerCase() === value.toLowerCase(),
  },
  {
    id: "platform",
    label: "Platform",
    prefix: "platform:",
    getValues: (pools) => [...new Set(pools.flatMap((p) => p.platforms))].sort(),
    match: (pool, value) => pool.platforms.some((p) => p.toLowerCase().includes(value.toLowerCase())),
  },
  {
    id: "backend",
    label: "Backend",
    prefix: "backend:",
    getValues: (pools) => [...new Set(pools.map((p) => p.backend))].sort(),
    match: (pool, value) => pool.backend.toLowerCase() === value.toLowerCase(),
  },
];

/**
 * Pre-computed lookup map for O(1) access.
 */
export const POOL_SEARCH_FIELD_MAP = new Map(POOL_SEARCH_FIELDS.map((f) => [f.id, f]));
