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
 * Timeline Dragger Component
 *
 * Interactive handle for adjusting time range boundaries.
 * Follows ResizeHandle pattern with:
 * - 2px visible line
 * - 16px hit area (8px on each side)
 * - Grip icon that appears on hover
 * - Cursor changes based on context
 *
 * ## Keyboard Accessibility
 *
 * - Arrow keys: Nudge ±5 minutes
 * - Enter/Space: Commit pending change
 * - Escape: Cancel pending change
 */

"use client";

import { GripVertical } from "lucide-react";
import { cn } from "@/lib/utils";

// =============================================================================
// Types
// =============================================================================

export interface TimelineDraggerProps {
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
  /** Additional CSS classes */
  className?: string;
}

// =============================================================================
// Component
// =============================================================================

/**
 * Draggable handle for time range boundaries.
 */
export function TimelineDragger({
  leftPercent,
  side,
  isDragging = false,
  isBlocked = false,
  onPointerDown,
  onKeyDown,
  className,
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
        className,
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
