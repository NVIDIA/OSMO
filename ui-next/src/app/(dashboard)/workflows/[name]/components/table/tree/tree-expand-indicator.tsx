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
 * TreeExpandIndicator Component
 *
 * Visual-only component that renders the tree expand/collapse indicator:
 * - Circle with +/- icon
 * - Vertical line down ONLY when expanded AND has visible tasks
 *
 * This is a purely presentational component - parent handles all click events.
 * Extracted from TreeGroupCell to be reusable in split-button patterns.
 *
 * ## Edge Cases
 *
 * - Expanded with visible tasks: [-] with vertical line down
 * - Expanded with no visible tasks (filtered out): [-] WITHOUT vertical line
 * - Collapsed: [+] without vertical line
 * - Single-task filtered out: [-] without vertical line (shows group exists)
 */

import { memo } from "react";
import { Plus, Minus } from "lucide-react";
import {
  CIRCLE_SIZE,
  ICON_SIZE,
  LINE_WIDTH,
} from "@/app/(dashboard)/workflows/[name]/components/table/tree/tree-constants";

// =============================================================================
// Types
// =============================================================================

export interface TreeExpandIndicatorProps {
  /** Whether the group is expanded */
  isExpanded: boolean;
  /** Whether the group has any visible tasks after filtering */
  hasVisibleTasks: boolean;
}

// =============================================================================
// Component
// =============================================================================

export const TreeExpandIndicator = memo(function TreeExpandIndicator({
  isExpanded,
  hasVisibleTasks,
}: TreeExpandIndicatorProps) {
  // Vertical line only when expanded AND has visible tasks
  const showVerticalLine = isExpanded && hasVisibleTasks;

  // Icon color matches row text color
  const iconColorClass = "text-gray-900 dark:text-zinc-100";

  return (
    <div className="relative flex h-full w-full items-center justify-center">
      {/* Circle with +/- indicator */}
      <div
        className="bg-tree-line relative z-10 flex items-center justify-center rounded-full"
        style={{
          width: `${CIRCLE_SIZE}px`,
          height: `${CIRCLE_SIZE}px`,
        }}
        aria-hidden="true"
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
      </div>

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
