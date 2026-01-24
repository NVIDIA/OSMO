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
 * URL Parsing Utilities for Server Components
 *
 * These utilities parse URL search params in the same format as nuqs hooks,
 * enabling server-side prefetching with matching query keys.
 *
 * Format: ?f=field1:value1&f=field2:value2
 */

import type { SearchChip } from "@/stores";

/**
 * Parse URL filter chips from searchParams.
 *
 * Matches the format used by useUrlChips hook:
 * - Single value: "status:RUNNING" or string
 * - Array: ["status:RUNNING", "user:alice"]
 *
 * @param param - The 'f' param from searchParams (string | string[] | undefined)
 * @returns Array of SearchChip objects
 *
 * @example
 * ```ts
 * // URL: /workflows?f=status:RUNNING&f=user:alice
 * const params = await searchParams;
 * const chips = parseUrlChips(params.f);
 * // chips = [
 * //   { field: "status", value: "RUNNING", label: "status: RUNNING" },
 * //   { field: "user", value: "alice", label: "user: alice" },
 * // ]
 * ```
 */
export function parseUrlChips(param: string | string[] | undefined): SearchChip[] {
  if (!param) return [];

  // Normalize to array
  const filterStrings = Array.isArray(param) ? param : [param];

  return filterStrings
    .map((str) => {
      const colonIndex = str.indexOf(":");
      if (colonIndex === -1) return null;
      const field = str.slice(0, colonIndex);
      const value = str.slice(colonIndex + 1);
      if (!field || !value) return null;
      const label = `${field}: ${value}`;
      return { field, value, label };
    })
    .filter((chip): chip is SearchChip => chip !== null);
}

/**
 * Convert SearchChips to the cache key string format.
 *
 * This matches buildWorkflowsQueryKey in workflows-shim.ts:
 * - Chips are sorted and joined with commas
 * - Format: "field1:value1,field2:value2"
 *
 * @param chips - Array of SearchChip objects
 * @returns Sorted, comma-joined string for cache key
 */
export { chipsToCacheKey as chipsToKeyString } from "@/lib/api/chip-filter-utils";
