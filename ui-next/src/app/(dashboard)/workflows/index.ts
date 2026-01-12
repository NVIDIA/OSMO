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
 * Workflows Feature Public API
 *
 * This is the public interface for the workflows feature. Other features should
 * only import from this file, not from internal paths.
 *
 * ## Architecture
 *
 * ```
 * workflows/
 * ├── index.ts          <- You are here (public API)
 * ├── page.tsx          <- Page component (list view)
 * ├── [name]/           <- Workflow detail page
 * │   ├── page.tsx
 * │   ├── hooks/
 * │   └── lib/
 * ├── hooks/            <- Data and state hooks
 * ├── lib/              <- Pure utilities, constants, column configs
 * ├── components/       <- UI components
 * └── stores/           <- Zustand stores
 * ```
 *
 * ## Usage
 *
 * ```tsx
 * import { useWorkflowsData, WORKFLOW_SEARCH_FIELDS } from "@/app/(dashboard)/workflows";
 * ```
 */

// =============================================================================
// Hooks
// =============================================================================

export { useWorkflowsData } from "./hooks/use-workflows-data";

// =============================================================================
// Search Fields & Presets
// =============================================================================

export {
  WORKFLOW_SEARCH_FIELDS,
  STATUS_PRESETS,
  createPresetChips,
  isPresetActive,
  togglePreset,
  type WorkflowListEntry,
  type StatusPresetId,
} from "./lib/workflow-search-fields";

// =============================================================================
// Column Configuration
// =============================================================================

export {
  MANDATORY_COLUMN_IDS,
  OPTIONAL_COLUMNS,
  DEFAULT_VISIBLE_COLUMNS,
  DEFAULT_COLUMN_ORDER,
  WORKFLOW_COLUMN_SIZE_CONFIG,
  isWorkflowColumnId,
  asWorkflowColumnIds,
  type WorkflowColumnId,
} from "./lib/workflow-columns";

// =============================================================================
// Constants
// =============================================================================

export {
  STATUS_CATEGORY_MAP,
  STATUS_LABELS,
  getStatusDisplay,
  STATUS_STYLES,
  PRIORITY_STYLES,
  getPriorityDisplay,
  ALL_WORKFLOW_STATUSES,
  matchStatus,
  getStatusSuggestions,
  type StatusCategory,
} from "./lib/workflow-constants";

// =============================================================================
// Stores
// =============================================================================

export { useWorkflowsTableStore, useWorkflowsPreferencesStore } from "./stores/workflows-table-store";
