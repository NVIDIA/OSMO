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
 * SplitGroupHeader Component
 *
 * Group header row with dual-action pattern:
 * - **Primary action (entire row)**: Expand/collapse group (click anywhere on row)
 * - **Secondary action (right button)**: Navigate to group details (Info icon)
 *
 * ## Visual Structure
 *
 * ```
 * ┌──────────────────────────────────────────────────────────┐
 * │ [+/-] GroupName · Group · (N tasks)              [i]     │
 * └──────────────────────────────────────────────────────────┘
 *  └─────────────────────────────────────┘   └────────┘
 *   Entire row = expand/collapse          Details button
 * ```
 *
 * ## Interaction Design
 *
 * - **Row click**: Expands/collapses group (like task rows)
 * - **Details button**: Small hover-interactive button on right with comfortable padding
 * - **Keyboard**: Tab moves to details button, Enter/Space activates
 *
 * ## Accessibility
 *
 * - Entire row is clickable div with role="button" and keyboard support
 * - Details button stops propagation to prevent double-action
 * - Icons are decorative (aria-hidden)
 * - Proper ARIA labels for both actions
 */

import { memo } from "react";
import { Info } from "lucide-react";
import type { GroupWithLayout } from "../../../lib/workflow-types";
import { TreeExpandIndicator } from "./TreeExpandIndicator";
import { GroupNameCell } from "./GroupNameCell";

// =============================================================================
// Types
// =============================================================================

export interface SplitGroupHeaderProps {
  /** Task group data */
  group: GroupWithLayout;
  /** Whether the group is expanded */
  isExpanded: boolean;
  /** Whether the group has any visible tasks after filtering */
  hasVisibleTasks: boolean;
  /** Total number of tasks in the group (unfiltered count) */
  taskCount: number;
  /** Callback when expand/collapse is clicked */
  onToggleExpand: () => void;
  /** Callback when details navigation is clicked */
  onViewDetails: () => void;
}

// =============================================================================
// Component
// =============================================================================

export const SplitGroupHeader = memo(function SplitGroupHeader({
  group,
  isExpanded,
  hasVisibleTasks,
  taskCount,
  onToggleExpand,
  onViewDetails,
}: SplitGroupHeaderProps) {
  const handleDetailsClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onViewDetails();
  };

  return (
    <div
      className="flex h-full w-full cursor-pointer items-center transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-900/50"
      onClick={onToggleExpand}
      role="button"
      tabIndex={0}
      aria-expanded={isExpanded}
      aria-label={isExpanded ? `Collapse ${group.name}` : `Expand ${group.name}`}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onToggleExpand();
        }
      }}
    >
      {/* Tree indicator (16px circle + icon) */}
      <div className="flex h-full w-8 shrink-0 items-center justify-center">
        <TreeExpandIndicator
          isExpanded={isExpanded}
          hasVisibleTasks={hasVisibleTasks}
        />
      </div>

      {/* Group name, badge, count */}
      <div className="flex min-w-0 flex-1 items-center px-4">
        <GroupNameCell
          name={group.name}
          taskCount={taskCount}
        />
      </div>

      {/* Details button (right side with padding) */}
      <button
        type="button"
        className="group/details focus-visible:ring-ring mr-4 flex shrink-0 cursor-pointer items-center justify-center rounded p-1 transition-colors duration-150 hover:bg-zinc-100 focus-visible:ring-2 focus-visible:outline-none dark:hover:bg-zinc-800"
        onClick={handleDetailsClick}
        aria-label={`View details for ${group.name}`}
      >
        <Info
          className="text-muted-foreground group-hover/details:text-foreground size-4 transition-colors"
          aria-hidden="true"
        />
      </button>
    </div>
  );
});
