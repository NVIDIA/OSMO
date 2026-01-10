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
 * GroupPanel Utilities
 *
 * Shared utilities for task tables: search, columns, and column definitions.
 * The main GroupPanel component has been consolidated into DetailsPanel/GroupDetails.
 */

// Search fields and presets
export { TASK_SEARCH_FIELDS, createTaskPresets, ensureChronoLoaded } from "./task-search-fields";

// Column configuration
export {
  OPTIONAL_COLUMNS,
  OPTIONAL_COLUMNS_ALPHABETICAL,
  DEFAULT_VISIBLE_COLUMNS,
  DEFAULT_COLUMN_ORDER,
  MANDATORY_COLUMN_IDS,
  TASK_COLUMN_SIZE_CONFIG,
  COLUMN_LABELS,
  COLUMN_MENU_LABELS,
  isTaskColumnId,
  asTaskColumnIds,
  type TaskColumnId,
} from "./task-columns";

// Column definitions for TanStack Table
export { createTaskColumns } from "./task-column-defs";

// Types (re-export from workflow-types for convenience)
export type { TaskWithDuration } from "../../workflow-types";
export type { SearchChip } from "@/components/smart-search";
