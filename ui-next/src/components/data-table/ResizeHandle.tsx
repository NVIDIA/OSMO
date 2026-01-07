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
 * Column Resize Handle
 *
 * Draggable handle for column resizing using @use-gesture/react for
 * robust gesture handling and useColumnSizing's Resize Control API.
 *
 * @see https://tanstack.com/table/v8/docs/guide/column-sizing
 * @see https://use-gesture.netlify.app/docs/gestures/#drag
 *
 * Features:
 * - Drag to resize (via useDrag from @use-gesture/react)
 * - Double-click to auto-fit content
 * - Keyboard accessible
 * - Touch support with proper tap vs drag detection
 *
 * Architecture:
 * - useDrag handles ALL gesture detection (no competing event listeners)
 * - Resize Control API (startResize/updateResize/endResize) manages state
 * - RAF-throttled DOM updates for 60fps performance during drag
 * - Clean lifecycle: first → active → last
 */

"use client";

import { memo, useState, useRef } from "react";
import { useDrag } from "@use-gesture/react";
import type { Header } from "@tanstack/react-table";
import { cn } from "@/lib/utils";
import { useStableCallback, useStableValue } from "@/hooks";

// =============================================================================
// Types
// =============================================================================

export interface ResizeHandleProps<TData> {
  /** TanStack header instance */
  header: Header<TData, unknown>;
  /**
   * Start resize - call from useDrag's `first` event.
   * @returns The starting width for delta calculations.
   */
  onResizeStart?: (columnId: string) => number;
  /**
   * Update resize - call from useDrag during drag.
   * @param columnId - Column being resized
   * @param newWidth - New width (startWidth + delta)
   */
  onResizeUpdate?: (columnId: string, newWidth: number) => void;
  /**
   * End resize - call from useDrag's `last` event.
   */
  onResizeEnd?: () => void;
  /** Double-click to auto-fit column */
  onAutoFit?: (columnId: string) => void;
}

// =============================================================================
// Component
// =============================================================================

function ResizeHandleInner<TData>({
  header,
  onResizeStart,
  onResizeUpdate,
  onResizeEnd,
  onAutoFit,
}: ResizeHandleProps<TData>) {
  const [isFocused, setIsFocused] = useState(false);
  const startWidthRef = useRef<number>(0);

  const isResizing = header.column.getIsResizing();
  const columnId = header.id;

  // Stable refs for callbacks to avoid stale closures in useDrag
  const onResizeStartRef = useStableValue(onResizeStart);
  const onResizeUpdateRef = useStableValue(onResizeUpdate);
  const onResizeEndRef = useStableValue(onResizeEnd);
  const onAutoFitRef = useStableValue(onAutoFit);

  // ==========================================================================
  // Drag Gesture - @use-gesture/react as the canonical gesture handler
  //
  // Clean lifecycle:
  // - first: Capture start width, initialize resize state
  // - active (not first, not last): Update column width
  // - last: Finalize and persist
  //
  // Using refs for all callbacks to avoid stale closures (useDrag memoizes)
  // ==========================================================================

  const bindDrag = useDrag(
    ({ first, last, movement: [mx], tap, event }) => {
      // Ignore taps - they're handled by onDoubleClick
      if (tap) return;

      // CRITICAL: Stop propagation to prevent @dnd-kit from triggering column reorder
      // This ensures resize and DnD don't interfere with each other
      event?.stopPropagation();
      event?.preventDefault();

      if (first) {
        // Drag started - capture starting width
        const startWidth = onResizeStartRef.current?.(columnId) ?? header.getSize();
        startWidthRef.current = startWidth;
      } else if (last) {
        // Drag ended - finalize and persist
        onResizeEndRef.current?.();
      } else {
        // During drag - update width
        const newWidth = startWidthRef.current + mx;
        onResizeUpdateRef.current?.(columnId, newWidth);
      }
    },
    {
      // Filter taps vs drags (double-click handled separately)
      filterTaps: true,
      // Minimum movement to start drag (pixels)
      threshold: 3,
      // Enable touch support
      pointer: { touch: true },
      // Prevent scrolling while dragging
      preventScrollAxis: "x",
    },
  );

  // ==========================================================================
  // Click Events - Auto-fit
  // ==========================================================================

  const handleDoubleClick = useStableCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onAutoFitRef.current?.(columnId);
  });

  // Keyboard support for accessibility
  const handleKeyDown = useStableCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onAutoFitRef.current?.(columnId);
    }
  });

  return (
    <div
      {...bindDrag()}
      className={cn(
        "resize-handle",
        "absolute top-0 right-0 bottom-0 z-10",
        "w-2 cursor-col-resize",
        "touch-none select-none",
        // Visual indicator line
        "after:absolute after:top-1/4 after:right-0.5 after:bottom-1/4 after:w-0.5",
        "after:rounded-full after:bg-transparent after:transition-colors",
        "hover:after:bg-zinc-400 dark:hover:after:bg-zinc-500",
        // Focus visible for keyboard navigation
        "focus-visible:outline-none focus-visible:after:bg-blue-500",
        // Active/resizing state
        (isResizing || isFocused) && "after:bg-zinc-500 dark:after:bg-zinc-400",
      )}
      data-no-dnd="true"
      onDoubleClick={handleDoubleClick}
      onKeyDown={handleKeyDown}
      onFocus={() => setIsFocused(true)}
      onBlur={() => setIsFocused(false)}
      role="separator"
      aria-orientation="vertical"
      aria-label={`Resize ${columnId} column. Double-click to auto-fit.`}
      tabIndex={0}
    />
  );
}

// Memo with generic support
export const ResizeHandle = memo(ResizeHandleInner) as <TData>(props: ResizeHandleProps<TData>) => React.ReactElement;
