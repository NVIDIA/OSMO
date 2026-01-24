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
 * Pools Feature Public API
 *
 * This is the public interface for the pools feature. Other features should
 * only import from this file, not from internal paths.
 *
 * ## Architecture
 *
 * ```
 * pools/
 * ├── index.ts          <- You are here (public API)
 * ├── page.tsx          <- Page component
 * ├── hooks/            <- Data and state hooks
 * ├── lib/              <- Pure utilities, constants, column configs
 * ├── components/       <- UI components
 * └── stores/           <- Zustand stores
 * ```
 *
 * ## Usage
 *
 * ```tsx
 * import { usePoolsData, POOL_SEARCH_FIELDS, POOL_PRESETS } from "@/app/(dashboard)/pools";
 * ```
 */

// =============================================================================
// Hooks
// =============================================================================

export { usePoolsData } from "./hooks/use-pools-data";
export { useSortedPools } from "./hooks/use-sorted-pools";

// =============================================================================
// Search Fields & Presets
// =============================================================================

export {
  createPoolSearchFields,
  parseNumericFilter,
  validateNumericFilter,
  compareNumeric,
} from "./lib/pool-search-fields";

// =============================================================================
// Column Configuration
// =============================================================================

export {
  MANDATORY_COLUMN_IDS,
  OPTIONAL_COLUMNS,
  DEFAULT_VISIBLE_COLUMNS,
  DEFAULT_COLUMN_ORDER,
  POOL_COLUMN_SIZE_CONFIG,
  DEFAULT_SORT,
  DEFAULT_PANEL_WIDTH,
  isPoolColumnId,
  asPoolColumnIds,
  type PoolColumnId,
} from "./lib/pool-columns";

// =============================================================================
// Constants
// =============================================================================

export { getStatusDisplay, STATUS_ORDER } from "./lib/constants";

// =============================================================================
// Stores
// =============================================================================

export { usePoolsTableStore, usePoolsExtendedStore } from "./stores/pools-table-store";
