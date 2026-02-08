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
 * - **Secondary action (inline button)**: Navigate to group details (ChevronRight icon)
 *
 * ## Visual Structure
 *
 * ```
 * ┌──────────────────────────────────────────────────────────┐
 * │ [+/-] GroupName · Group · (N tasks) [>]                  │
 * └──────────────────────────────────────────────────────────┘
 *  └────────────────────────────────────────┘
 *   Entire row = expand/collapse (chevron inline with content)
 * ```
 *
 * ## Interaction Design
 *
 * - **Row click**: Expands/collapses group (like task rows)
 * - **Chevron button**: Positioned immediately after task count, indicates navigation
 * - **Keyboard**: Tab moves to chevron button, Enter/Space activates
 * - **Truncation safety**: When name is long, chevron remains visible (shrink-0)
 *
 * ## Accessibility
 *
 * - Entire row is clickable div with role="button" and keyboard support
 * - Chevron button stops propagation to prevent double-action
 * - Icons are decorative (aria-hidden)
 * - Proper ARIA labels for both actions
 */

import { memo } from "react";
import { ChevronRight } from "lucide-react";
import type { GroupWithLayout } from "@/app/(dashboard)/workflows/[name]/lib/workflow-types";
import { TreeExpandIndicator } from "@/app/(dashboard)/workflows/[name]/components/table/tree/TreeExpandIndicator";
import { GroupNameCell } from "@/app/(dashboard)/workflows/[name]/components/table/tree/GroupNameCell";

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

      {/* Group name, badge, count, and navigation button */}
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <GroupNameCell
          name={group.name}
          taskCount={taskCount}
        />

        {/* Navigation button (inline with content) */}
        <button
          type="button"
          className="group/details focus-visible:ring-ring -ml-0.5 flex shrink-0 cursor-pointer items-center justify-center rounded p-1 transition-colors duration-150 hover:bg-zinc-100 focus-visible:ring-2 focus-visible:outline-none dark:hover:bg-zinc-800"
          onClick={handleDetailsClick}
          aria-label={`Navigate to ${group.name} details`}
        >
          <ChevronRight
            className="text-muted-foreground group-hover/details:text-foreground size-3.5 transition-colors"
            aria-hidden="true"
          />
        </button>
      </div>
    </div>
  );
});
