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
 * GroupNameCell Component
 *
 * Renders the Name column content for group rows:
 * - Bold group name
 * - "Group" badge to distinguish from task rows
 * - Muted task count showing TOTAL tasks (not filtered count)
 *
 * The count always shows the original number of tasks in the group,
 * regardless of filtering, to help users understand the full data.
 *
 * Note: Click handling is done by the parent <td> element, not this component.
 */

import { memo } from "react";
import { Badge } from "@/components/shadcn/badge";

// =============================================================================
// Types
// =============================================================================

export interface GroupNameCellProps {
  /** Group name to display */
  name: string;
  /** Total number of tasks in the group (unfiltered count) */
  taskCount: number;
}

// =============================================================================
// Component
// =============================================================================

export const GroupNameCell = memo(function GroupNameCell({ name, taskCount }: GroupNameCellProps) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <span className="text-foreground truncate font-semibold">{name}</span>
      <Badge
        variant="outline"
        className="shrink-0 rounded-md text-[10px] font-medium tracking-wide uppercase"
      >
        Group
      </Badge>
      <span className="text-muted-foreground shrink-0 text-sm">
        ({taskCount} {taskCount === 1 ? "task" : "tasks"})
      </span>
    </div>
  );
});
