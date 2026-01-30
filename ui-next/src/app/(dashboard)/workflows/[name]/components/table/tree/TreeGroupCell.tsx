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
 * TreeGroupCell Component
 *
 * Renders the tree column cell for group rows (multi-task and filtered single-task):
 * - Circle with +/- indicator for expand/collapse
 * - Vertical line down ONLY when expanded AND has visible tasks
 *
 * ## Edge Cases
 *
 * - Expanded with visible tasks: [-] with vertical line down
 * - Expanded with no visible tasks (filtered out): [-] WITHOUT vertical line
 * - Collapsed: [+] without vertical line
 * - Single-task filtered out: [-] without vertical line (shows group exists)
 *
 * ## Visual Structure
 *
 * Collapsed [+]:          Expanded [-] with tasks:   Expanded [-] no tasks:
 * +------------+          +------------+             +------------+
 * |            |          |            |             |            |
 * |    [+]     |          |    [-]     |             |    [-]     |
 * |            |          |     |      |             |            |
 * |            |          |     |      |             |            |
 * +------------+          +------------+             +------------+
 */

import { memo, useCallback } from "react";
import { Plus, Minus } from "lucide-react";
import { cn } from "@/lib/utils";
import { CIRCLE_SIZE, ICON_SIZE, LINE_WIDTH } from "./tree-constants";

// =============================================================================
// Types
// =============================================================================

export interface TreeGroupCellProps {
  /** Whether the group is expanded */
  isExpanded: boolean;
  /** Whether the group has any visible tasks after filtering */
  hasVisibleTasks: boolean;
  /** Callback when expand/collapse is toggled */
  onToggle: () => void;
  /** Optional className for the container */
  className?: string;
}

// =============================================================================
// Component
// =============================================================================

export const TreeGroupCell = memo(function TreeGroupCell({
  isExpanded,
  hasVisibleTasks,
  onToggle,
  className,
}: TreeGroupCellProps) {
  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onToggle();
    },
    [onToggle],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        e.stopPropagation();
        onToggle();
      }
    },
    [onToggle],
  );

  // Vertical line only when expanded AND has visible tasks
  const showVerticalLine = isExpanded && hasVisibleTasks;

  // Icon color matches row text color
  const iconColorClass = "text-gray-900 dark:text-zinc-100";

  return (
    <div className={cn("relative flex h-full w-full items-center justify-center", className)}>
      {/* Circle button with +/- indicator */}
      <button
        type="button"
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        className={cn(
          "relative z-10 flex items-center justify-center rounded-full",
          // Background matches tree connector line color
          "bg-tree-line",
          "transition-opacity duration-150",
          "cursor-pointer hover:opacity-80",
          "focus-visible:ring-ring focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:outline-none",
        )}
        style={{
          width: `${CIRCLE_SIZE}px`,
          height: `${CIRCLE_SIZE}px`,
        }}
        aria-expanded={isExpanded}
        aria-label={isExpanded ? "Collapse group" : "Expand group"}
      >
        {isExpanded ? (
          <Minus
            className={iconColorClass}
            style={{ width: `${ICON_SIZE}px`, height: `${ICON_SIZE}px` }}
            aria-hidden="true"
          />
        ) : (
          <Plus
            className={iconColorClass}
            style={{ width: `${ICON_SIZE}px`, height: `${ICON_SIZE}px` }}
            aria-hidden="true"
          />
        )}
      </button>

      {/* Vertical line - ONLY when expanded AND has visible tasks */}
      {showVerticalLine && (
        <div
          className="bg-tree-line absolute bottom-0 left-1/2"
          style={{
            width: `${LINE_WIDTH}px`,
            height: `calc(50% - ${CIRCLE_SIZE / 2}px)`,
            transform: "translateX(-50%)",
          }}
          aria-hidden="true"
        />
      )}
    </div>
  );
});
