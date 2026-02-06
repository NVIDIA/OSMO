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
 * WorkflowTasksToolbar Component
 *
 * Toolbar for the workflow tasks table with search/filter capabilities.
 * Uses the canonical TableToolbar component with task-specific search fields
 * and status presets.
 */

"use client";

import { memo } from "react";
import type { SearchChip, ResultsCount } from "@/components/filter-bar/lib/types";
import { TableToolbar } from "@/components/data-table/TableToolbar";
import { useTaskTableStore } from "../../stores/task-table-store";
import { OPTIONAL_COLUMNS } from "../../lib/task-columns";
import { TASK_SEARCH_FIELDS, TASK_PRESETS } from "../../lib/task-search-fields";
import type { TaskWithDuration } from "../../lib/workflow-types";

// =============================================================================
// Types
// =============================================================================

export interface WorkflowTasksToolbarProps {
  /** All tasks for FilterBar autocomplete */
  tasks: TaskWithDuration[];
  /** Current search chips */
  searchChips: SearchChip[];
  /** Callback when chips change */
  onSearchChipsChange: (chips: SearchChip[]) => void;
  /** Results count for displaying "N results" or "M of N results" */
  resultsCount?: ResultsCount;
}

// =============================================================================
// Component
// =============================================================================

export const WorkflowTasksToolbar = memo(function WorkflowTasksToolbar({
  tasks,
  searchChips,
  onSearchChipsChange,
  resultsCount,
}: WorkflowTasksToolbarProps) {
  const visibleColumnIds = useTaskTableStore((s) => s.visibleColumnIds);
  const toggleColumn = useTaskTableStore((s) => s.toggleColumn);

  return (
    <TableToolbar
      data={tasks}
      searchFields={TASK_SEARCH_FIELDS}
      columns={OPTIONAL_COLUMNS}
      visibleColumnIds={visibleColumnIds}
      onToggleColumn={toggleColumn}
      searchChips={searchChips}
      onSearchChipsChange={onSearchChipsChange}
      placeholder="Search tasks... (try 'name:', 'status:', 'node:', 'duration:')"
      searchPresets={TASK_PRESETS}
      resultsCount={resultsCount}
    />
  );
});
