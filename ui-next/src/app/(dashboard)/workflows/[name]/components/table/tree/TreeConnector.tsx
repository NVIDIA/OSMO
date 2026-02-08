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
 * TreeConnector Component
 *
 * Renders tree visualization for task rows with three distinct modes:
 *
 * 1. **Single-task group**: Empty (no icon) - task is its own group
 * 2. **Last visible task (L)**: L-bend connector from above, no continuation
 * 3. **Middle task (T)**: L-bend connector with vertical continuation
 *
 * ## Visual Modes
 *
 * Single-task:            Last task:             Middle task:
 * +------------+          +------------+         +------------+
 * |            |          |      |     |         |      |     |
 * |            |          |      |     |         |      |     |
 * |            |          |      +-----|         |      +-----|
 * |            |          |            |         |      |     |
 * +------------+          +------------+         +------------+
 *
 * IMPORTANT: The `isLast` flag is based on the FINAL visible task list
 * (after filtering and sorting), not the original task array.
 *
 * Uses CSS borders with border-radius for smooth L-shaped connectors.
 */

import { memo } from "react";
import { cn } from "@/lib/utils";
import { CORNER_RADIUS, LINE_WIDTH } from "@/app/(dashboard)/workflows/[name]/components/table/tree/tree-constants";

// =============================================================================
// Types
// =============================================================================

export interface TreeConnectorProps {
  /** Whether this is the last visible task in the group */
  isLast: boolean;
  /** Whether this task is a single-task group (renders as empty circle) */
  isSingleTaskGroup?: boolean;
  /** Optional className for additional styling */
  className?: string;
}

// =============================================================================
// Sub-components
// =============================================================================

/**
 * L-shaped connector for tasks in multi-task groups.
 *
 * Uses a combination of:
 * - Vertical line from top to center
 * - A single border element with rounded bottom-left corner
 * - Vertical continuation for non-last tasks
 *
 * The connector flows: top → down to center → right with rounded corner → to edge
 */
function LConnector({ isLast }: { isLast: boolean }) {
  return (
    <>
      {/* Vertical line from top to center (connects to group's vertical line above) */}
      <div
        className="bg-tree-line absolute top-0 left-1/2"
        style={{
          width: `${LINE_WIDTH}px`,
          height: `50%`,
          transform: "translateX(-50%)",
        }}
        aria-hidden="true"
      />

      {/* L-bend with rounded corner: vertical down + horizontal right */}
      <div
        className="border-tree-line absolute"
        style={{
          // Position at center
          left: `calc(50% - ${LINE_WIDTH / 2}px)`,
          top: `calc(50% - ${LINE_WIDTH}px)`,
          // Size: goes from center to right edge
          width: `calc(50% + ${LINE_WIDTH / 2}px)`,
          height: `${CORNER_RADIUS + LINE_WIDTH}px`,
          // Border on left and bottom for the L shape
          borderLeftWidth: `${LINE_WIDTH}px`,
          borderBottomWidth: `${LINE_WIDTH}px`,
          borderLeftStyle: "solid",
          borderBottomStyle: "solid",
          borderBottomLeftRadius: `${CORNER_RADIUS}px`,
        }}
        aria-hidden="true"
      />

      {/* Vertical continuation below center (for non-last tasks only) */}
      {!isLast && (
        <div
          className="bg-tree-line absolute bottom-0 left-1/2"
          style={{
            width: `${LINE_WIDTH}px`,
            height: `calc(50% - ${CORNER_RADIUS}px)`,
            transform: "translateX(-50%)",
          }}
          aria-hidden="true"
        />
      )}
    </>
  );
}

// =============================================================================
// Main Component
// =============================================================================

export const TreeConnector = memo(function TreeConnector({ isLast, isSingleTaskGroup, className }: TreeConnectorProps) {
  // Mode 1: Single-task group - empty (no icon)
  if (isSingleTaskGroup) {
    return (
      <div
        className={cn("relative flex h-full w-full", className)}
        aria-hidden="true"
      />
    );
  }

  // Mode 2 & 3: Multi-task group - L-connector
  return (
    <div
      className={cn("relative flex h-full w-full items-center justify-center", className)}
      aria-hidden="true"
    >
      <LConnector isLast={isLast} />
    </div>
  );
});
