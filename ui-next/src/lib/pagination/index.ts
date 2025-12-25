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
 * Pagination module - Generic infinite scroll infrastructure.
 *
 * This module provides:
 * - Type-safe pagination types
 * - Generic useInfiniteDataTable hook
 * - Consistent interface across different data sources
 *
 * @example
 * ```tsx
 * import { useInfiniteDataTable, type PaginatedResponse } from "@/lib/pagination";
 *
 * const result = useInfiniteDataTable({
 *   queryKey: ['my-data', filters],
 *   queryFn: fetchPaginatedData,
 *   params: { filters },
 * });
 * ```
 */

export * from "./types";
export {
  useInfiniteDataTable,
  INFINITE_PAGINATION_DEFAULTS,
  type UseInfiniteDataTableOptions,
} from "./use-infinite-data-table";
