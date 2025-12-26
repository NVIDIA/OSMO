/**
 * SPDX-FileCopyrightText: Copyright (c) 2025 NVIDIA CORPORATION. All rights reserved.
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
 * Filters module - Generic filter state management primitives.
 *
 * This module provides reusable hooks for building filterable lists
 * across different entity types (resources, pools, workflows, tasks, etc.).
 *
 * @example
 * ```tsx
 * import { useSetFilter, useDeferredSearch, useActiveFilters } from "@/lib/filters";
 *
 * // In a headless hook for any entity type
 * const poolFilter = useSetFilter<string>();
 * const statusFilter = useSetFilter<Status>({ singleSelect: true });
 * const search = useDeferredSearch();
 *
 * const activeFilters = useActiveFilters([
 *   { type: "search", getValues: () => search.value ? [search.value] : [], ... },
 *   { type: "pool", getValues: () => [...poolFilter.selected], ... },
 * ]);
 * ```
 */

// Types
export type {
  SetFilterOptions,
  SetFilterResult,
  DeferredSearchResult,
  ActiveFilter,
  FilterDefinition,
  ActiveFiltersResult,
} from "./types";

// Hooks - In-memory state (for local-only filters)
export { useSetFilter } from "./use-set-filter";
export { useDeferredSearch } from "./use-deferred-search";
export { useActiveFilters } from "./use-active-filters";

// Hooks - URL-synced state (for shareable/bookmarkable filters)
export { useUrlSearch, useUrlSetFilter, useUrlResourceTypeFilter, parseAsResourceType } from "./nuqs";
