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
 * Chip-to-Filter Utilities
 *
 * Utilities for converting FilterBar chips to filter parameters.
 * Consolidates the chip conversion pattern used across data hooks.
 *
 * ## Design Decision
 *
 * After analyzing the data hooks (pools, resources, workflows), each has
 * significantly different requirements:
 *
 * - Pools: Simple client-side filtering via adapter
 * - Resources: Paginated with hybrid client/server filtering
 * - Workflows: Paginated with full server-side filtering
 *
 * Rather than force a complex factory pattern that obscures these differences,
 * we provide reusable utilities that hooks can compose as needed.
 *
 * @example
 * ```tsx
 * // In a data hook
 * const filterParams = useMemo(
 *   () => chipsToParams(searchChips, POOL_CHIP_MAPPING),
 *   [searchChips]
 * );
 * ```
 */

import type { SearchChip } from "@/stores";

// =============================================================================
// Types
// =============================================================================

/**
 * Mapping configuration for chip-to-filter conversion.
 *
 * Defines how each chip field maps to a filter parameter:
 * - `array`: Chip values are collected into an array (e.g., statuses)
 * - `single`: Chip value is a single string (e.g., search term)
 */
export type ChipFieldMapping<T> = { type: "array"; paramKey: keyof T } | { type: "single"; paramKey: keyof T };

export type ChipMappingConfig<T> = Record<string, ChipFieldMapping<T>>;

// =============================================================================
// Core Conversion Function
// =============================================================================

/**
 * Convert FilterBar chips to filter parameters using a mapping config.
 *
 * @param chips - FilterBar chips to convert
 * @param mapping - Configuration mapping chip fields to param keys
 * @returns Filter parameters object
 *
 * @example
 * ```tsx
 * const POOL_MAPPING: ChipMappingConfig<PoolFilterParams> = {
 *   status: { type: "array", paramKey: "statuses" },
 *   platform: { type: "array", paramKey: "platforms" },
 *   search: { type: "single", paramKey: "search" },
 * };
 *
 * const params = chipsToParams(chips, POOL_MAPPING);
 * // { statuses: ["ONLINE"], platforms: ["dgx"], search: "my-pool" }
 * ```
 */
export function chipsToParams<T extends Record<string, unknown>>(
  chips: SearchChip[],
  mapping: ChipMappingConfig<T>,
): Partial<T> {
  const params = {} as Partial<T>;

  for (const chip of chips) {
    const fieldMapping = mapping[chip.field];
    if (!fieldMapping) continue;

    const { type, paramKey } = fieldMapping;

    if (type === "array") {
      const existing = (params[paramKey] as string[] | undefined) ?? [];
      (params[paramKey] as string[]) = [...existing, chip.value];
    } else {
      // single - last value wins
      (params[paramKey] as string) = chip.value;
    }
  }

  return params;
}

// =============================================================================
// Filter Helpers
// =============================================================================

/**
 * Filter chips to only those handled by a specific set of fields.
 *
 * Useful when some chips are handled server-side and others client-side.
 *
 * @param chips - All chips
 * @param handledFields - Set of field names handled by the target
 * @param exclude - If true, return chips NOT in handledFields
 */
export function filterChipsByFields(chips: SearchChip[], handledFields: Set<string>, exclude = false): SearchChip[] {
  return chips.filter((chip) => (exclude ? !handledFields.has(chip.field) : handledFields.has(chip.field)));
}

/**
 * Build a stable cache key segment from chips.
 *
 * Creates a deterministic string from chips for use in query keys.
 */
export function chipsToCacheKey(chips: SearchChip[]): string {
  return chips
    .map((c) => `${c.field}:${c.value}`)
    .sort()
    .join(",");
}
