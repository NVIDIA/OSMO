//SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION. All rights reserved.

//Licensed under the Apache License, Version 2.0 (the "License");
//you may not use this file except in compliance with the License.
//You may obtain a copy of the License at

//http://www.apache.org/licenses/LICENSE-2.0

//Unless required by applicable law or agreed to in writing, software
//distributed under the License is distributed on an "AS IS" BASIS,
//WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//See the License for the specific language governing permissions and
//limitations under the License.

//SPDX-License-Identifier: Apache-2.0

/**
 * Timeline Window Component
 *
 * Renders the viewing "portal" for the timeline - a unified window with:
 * - Left/right opaque panels covering areas outside the effective range
 * - Grippers on the edges to adjust the window bounds
 *
 * This represents the effective time range being viewed/queried for logs.
 *
 * ## Visual Design
 *
 * - Opaque panels: `bg-black/10 dark:bg-white/5` - clearly shows non-visible areas
 * - Grippers: Draggable handles on panel edges showing start/end boundaries
 * - Z-index: 2 (above histogram bars and invalid zones)
 */

"use client";

import { cn } from "@/lib/utils";
import { TimelineDragger } from "./TimelineDragger";
import type { DraggerGesture } from "./use-timeline-gestures";

// =============================================================================
// Types
// =============================================================================

export interface TimelineWindowProps {
  /** Left panel position from left edge as percentage (0-100) */
  leftPanelStart: number;
  /** Left panel width as percentage (0-100) */
  leftPanelWidth: number;
  /** Right panel position from left edge as percentage (0-100) */
  rightPanelStart: number;
  /** Right panel width as percentage (0-100) */
  rightPanelWidth: number;
  /** Start dragger gesture handler */
  startDragger: DraggerGesture;
  /** End dragger gesture handler */
  endDragger: DraggerGesture;
  /** Additional CSS classes */
  className?: string;
}

// =============================================================================
// Component
// =============================================================================

/**
 * Timeline Window - unified viewing portal with panels and grippers.
 */
export function TimelineWindow({
  leftPanelStart,
  leftPanelWidth,
  rightPanelStart,
  rightPanelWidth,
  startDragger,
  endDragger,
  className,
}: TimelineWindowProps) {
  return (
    <div className={cn("pointer-events-none absolute inset-0", className)}>
      {/* Left panel - covers area before effective start */}
      {leftPanelWidth > 0 && (
        <div
          className="absolute top-0 h-full bg-black/10 transition-all duration-200 ease-out dark:bg-white/5"
          style={{
            left: `${leftPanelStart}%`,
            width: `${leftPanelWidth}%`,
          }}
          aria-hidden="true"
          data-panel="left"
        />
      )}

      {/* Right panel - covers area after effective end */}
      {rightPanelWidth > 0 && (
        <div
          className="absolute top-0 h-full bg-black/10 transition-all duration-200 ease-out dark:bg-white/5"
          style={{
            left: `${rightPanelStart}%`,
            width: `${rightPanelWidth}%`,
          }}
          aria-hidden="true"
          data-panel="right"
        />
      )}

      {/* Start gripper - left edge of the window */}
      <TimelineDragger
        leftPercent={startDragger.positionPercent}
        side="start"
        isDragging={startDragger.isDragging}
        isBlocked={startDragger.isBlocked}
        onPointerDown={startDragger.onPointerDown}
        onKeyDown={startDragger.onKeyDown}
      />

      {/* End gripper - right edge of the window */}
      <TimelineDragger
        leftPercent={endDragger.positionPercent}
        side="end"
        isDragging={endDragger.isDragging}
        isBlocked={endDragger.isBlocked}
        onPointerDown={endDragger.onPointerDown}
        onKeyDown={endDragger.onKeyDown}
      />
    </div>
  );
}
