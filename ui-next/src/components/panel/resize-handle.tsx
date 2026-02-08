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

"use client";

import { memo, useMemo } from "react";
import { GripVertical } from "lucide-react";
import { cn } from "@/lib/utils";
import { PANEL } from "@/components/panel/panel-header-controls";

// =============================================================================
// Types
// =============================================================================

export interface ResizeHandleProps {
  /** Bind props from useResizablePanel or useDrag - call this to get the event handlers */
  bindResizeHandle: () => React.HTMLAttributes<HTMLDivElement>;
  /** Whether the handle is currently being dragged */
  isDragging: boolean;
  /** Additional className for positioning (e.g., "left-0" or custom position) */
  className?: string;
  /** Custom style for dynamic positioning */
  style?: React.CSSProperties;
  /** Current value for aria-valuenow (panel width percentage) */
  "aria-valuenow"?: number;
  /** Min value for aria-valuemin */
  "aria-valuemin"?: number;
  /** Max value for aria-valuemax */
  "aria-valuemax"?: number;
}

// =============================================================================
// Component
// =============================================================================

/**
 * ResizeHandle - Draggable handle for resizing panels.
 *
 * Features:
 * - Wide hit area (16px) for easy targeting
 * - Thin visual indicator (2px) that appears on hover
 * - Centered grip icon that appears on hover/drag
 * - Accessible with proper ARIA attributes
 *
 * @example
 * ```tsx
 * // Inside a panel at the left edge
 * <ResizeHandle
 *   bindResizeHandle={bindResizeHandle}
 *   isDragging={isDragging}
 *   className="absolute inset-y-0 left-0 -translate-x-1/2 z-50"
 *   aria-valuenow={panelWidth}
 * />
 *
 * // Positioned dynamically in a container
 * <ResizeHandle
 *   bindResizeHandle={bindResizeHandle}
 *   isDragging={isDragging}
 *   className="absolute top-0 h-full z-20"
 *   style={{ left: `${100 - panelPct}%` }}
 *   aria-valuenow={panelPct}
 * />
 * ```
 */
export const ResizeHandle = memo(function ResizeHandle({
  bindResizeHandle,
  isDragging,
  className,
  style,
  "aria-valuenow": ariaValueNow,
  "aria-valuemin": ariaValueMin = PANEL.MIN_WIDTH_PCT,
  "aria-valuemax": ariaValueMax = PANEL.MAX_WIDTH_PCT,
}: ResizeHandleProps) {
  // Memoize style object to avoid recreating on every render
  // Note: transform is typically handled via className (e.g., -translate-x-1/2) for semantic positioning
  // willChange hint is only needed during drag for styles that change dynamically
  const computedStyle = useMemo(
    () => ({
      willChange: isDragging ? "transform" : "auto",
      ...style,
    }),
    [style, isDragging],
  );

  return (
    <div
      {...bindResizeHandle()}
      className={cn(
        // Base: wide hit area, cursor, touch handling
        "group w-4 cursor-ew-resize touch-none",
        // Visual indicator: thin line in center of hit area
        "before:absolute before:inset-y-0 before:left-1/2 before:w-0.5 before:-translate-x-1/2 before:transition-colors",
        isDragging
          ? "before:bg-blue-500"
          : "before:bg-transparent hover:before:bg-zinc-300 dark:hover:before:bg-zinc-600",
        className,
      )}
      style={computedStyle}
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize panel"
      aria-valuenow={ariaValueNow}
      aria-valuemin={ariaValueMin}
      aria-valuemax={ariaValueMax}
    >
      {/* Grip icon - visible on hover and during drag */}
      <div
        className={cn(
          "absolute top-1/2 left-1/2 z-10 -translate-x-1/2 -translate-y-1/2",
          "rounded-sm bg-zinc-100 px-px py-1 shadow-md transition-opacity duration-150",
          "dark:bg-zinc-800",
          isDragging ? "opacity-100" : "opacity-0 group-hover:opacity-100",
        )}
        aria-hidden="true"
      >
        <GripVertical
          className="size-3 text-zinc-400 dark:text-zinc-500"
          strokeWidth={1.5}
        />
      </div>
    </div>
  );
});
