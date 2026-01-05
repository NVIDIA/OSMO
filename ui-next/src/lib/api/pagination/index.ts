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
 * Pagination module - Generic infinite scroll / paginated data infrastructure.
 *
 * This module provides:
 * - Type-safe pagination types
 * - Generic usePaginatedData hook for any paginated entity
 * - Consistent interface across different data sources
 *
 * @example
 * ```tsx
 * import { usePaginatedData, type PaginatedResponse } from "@/lib/api/pagination";
 *
 * const result = usePaginatedData({
 *   queryKey: ['my-data', filters],
 *   queryFn: fetchData,
 *   params: { filters },
 * });
 * ```
 */

export * from "./types";
export { usePaginatedData, PAGINATED_DATA_DEFAULTS, type UsePaginatedDataOptions } from "./use-paginated-data";
