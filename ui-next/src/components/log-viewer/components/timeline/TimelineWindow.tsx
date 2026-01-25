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
 * - Left/right opaque panels (overlays) covering areas outside the effective range
 * - Grippers on the edges to adjust the window bounds
 *
 * ## Architecture (2-Layer Model)
 *
 * This is **Layer 2 (fixed window)** - stays in place while Layer 1 (bars + invalid zones) pans underneath.
 *
 * Structure: `[left overlay] | <----viewport----> | [right overlay]`
 *
 * Represents the effective time range being viewed/queried for logs.
 *
 * ## Pan Constraints
 *
 * Panning stops when invalid zones (from Layer 1) hit the overlay borders:
 * - Left: invalidZoneLeft's right edge touches left overlay's right edge
 * - Right: invalidZoneRight's left edge touches right overlay's left edge
 *
 * ## Visual Design
 *
 * - Opaque panels: `bg-black/10 dark:bg-white/5` - clearly shows non-visible areas
 * - Grippers: Draggable handles on panel edges showing start/end boundaries
 * - Z-index: 2 (above pannable layer)
 */

"use client";

import { GripVertical } from "lucide-react";
import { cn } from "@/lib/utils";
import type { DraggerGesture } from "./use-timeline-gestures";

// =============================================================================
// Timeline Dragger (colocated - only used by TimelineWindow)
// =============================================================================

/**
 * Timeline Dragger - Interactive handle for adjusting time range boundaries.
 * Part of Layer 2 (fixed window) - allows dragging effective time boundaries.
 *
 * Follows ResizeHandle pattern:
 * - 2px visible line
 * - 16px hit area (8px on each side)
 * - Grip icon appears on hover
 * - Keyboard accessible (arrow keys nudge ±5 minutes)
 */
interface TimelineDraggerProps {
  /** Position from left edge as percentage (0-100) */
  leftPercent: number;
  /** Side: start or end boundary */
  side: "start" | "end";
  /** Whether this dragger is being dragged */
  isDragging?: boolean;
  /** Whether drag is blocked (e.g., trying to extend past NOW) */
  isBlocked?: boolean;
  /** Pointer down handler for initiating drag */
  onPointerDown?: (e: React.PointerEvent) => void;
  /** Key down handler for keyboard navigation */
  onKeyDown?: (e: React.KeyboardEvent) => void;
}

function TimelineDragger({
  leftPercent,
  side,
  isDragging = false,
  isBlocked = false,
  onPointerDown,
  onKeyDown,
}: TimelineDraggerProps) {
  return (
    <div
      role="slider"
      aria-label={`${side === "start" ? "Start" : "End"} time boundary`}
      aria-orientation="horizontal"
      aria-valuenow={Math.round(leftPercent)}
      aria-valuemin={0}
      aria-valuemax={100}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
      className={cn(
        "group pointer-events-auto absolute top-0 z-10 flex h-full items-center justify-center",
        "transition-opacity duration-200",
        // Hit area: 16px wide (8px on each side of the line)
        "w-4",
        // Cursor states
        !isBlocked && "cursor-col-resize",
        isBlocked && "cursor-not-allowed",
        // Focus ring
        "focus-nvidia outline-none",
      )}
      style={{
        left: `calc(${leftPercent}% - 8px)`, // Center the 16px hit area on the line
      }}
      data-dragger-side={side}
    >
      {/* Visual line - 2px wide, centered */}
      <div
        className={cn(
          "absolute h-full w-0.5",
          "transition-colors duration-200",
          // Default state
          !isDragging && !isBlocked && "bg-border",
          // Hover state
          !isDragging && !isBlocked && "group-hover:bg-blue-500",
          // Dragging state
          isDragging && !isBlocked && "bg-blue-500",
          // Blocked state
          isBlocked && "bg-red-500",
        )}
      />

      {/* Grip icon - appears on hover/drag */}
      <div
        className={cn(
          "bg-background border-border absolute flex items-center justify-center rounded border",
          "size-6",
          "transition-opacity duration-200",
          // Hidden by default
          "opacity-0",
          // Show on hover/drag
          "group-hover:opacity-100",
          isDragging && "opacity-100",
        )}
      >
        <GripVertical
          className={cn(
            "size-3",
            !isBlocked && "text-muted-foreground",
            isDragging && !isBlocked && "text-blue-500",
            isBlocked && "text-red-500",
          )}
        />
      </div>
    </div>
  );
}

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
