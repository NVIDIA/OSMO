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
 * Resources Feature Public API
 *
 * This is the public interface for the resources feature. Other features should
 * only import from this file, not from internal paths.
 *
 * ## Architecture
 *
 * ```
 * resources/
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
 * import { useResourcesData, RESOURCE_SEARCH_FIELDS } from "@/app/(dashboard)/resources";
 * ```
 */

// =============================================================================
// Hooks
// =============================================================================

export { useResourcesData } from "./hooks/use-resources-data";

// =============================================================================
// Search Fields & Presets
// =============================================================================

export {
  RESOURCE_SEARCH_FIELDS,
  parseNumericFilter,
  validateNumericFilter,
  compareNumeric,
} from "./lib/resource-search-fields";

// =============================================================================
// Column Configuration
// =============================================================================

export {
  MANDATORY_COLUMN_IDS,
  OPTIONAL_COLUMNS,
  DEFAULT_VISIBLE_COLUMNS,
  DEFAULT_COLUMN_ORDER,
  RESOURCE_COLUMN_SIZE_CONFIG,
  DEFAULT_SORT,
  DEFAULT_PANEL_WIDTH,
  isResourceColumnId,
  asResourceColumnIds,
  type ResourceColumnId,
} from "./lib/resource-columns";

// =============================================================================
// Constants
// =============================================================================

export { LAYOUT, ResourceAllocationTypeDisplay, getResourceAllocationTypeDisplay } from "./lib/constants";

// =============================================================================
// Stores
// =============================================================================

export { useResourcesTableStore } from "./stores/resources-table-store";
