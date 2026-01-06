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
 * Draggable handle for column resizing using TanStack Table's native APIs
 * and @use-gesture/react for robust gesture detection.
 *
 * @see https://tanstack.com/table/v8/docs/guide/column-sizing
 *
 * Features:
 * - Drag to resize (via TanStack's `header.getResizeHandler()`)
 * - Double-click to auto-fit content
 * - Shift + double-click to reset to proportional
 * - Keyboard accessible
 * - Touch support with proper tap vs drag detection
 */

"use client";

import { memo, useState } from "react";
import { useDrag } from "@use-gesture/react";
import type { Header } from "@tanstack/react-table";
import { cn } from "@/lib/utils";
import { useStableCallback, useStableValue } from "@/hooks";

// =============================================================================
// Types
// =============================================================================

export interface ResizeHandleProps<TData> {
  /** TanStack header instance (provides getResizeHandler) */
  header: Header<TData, unknown>;
  /** Called when resize ends (for persistence) */
  onResizeEnd?: () => void;
  /** Double-click to auto-fit column */
  onAutoFit?: (columnId: string) => void;
  /** Shift + double-click to reset column */
  onReset?: (columnId: string) => void;
}

// =============================================================================
// Component
// =============================================================================

function ResizeHandleInner<TData>({ header, onResizeEnd, onAutoFit, onReset }: ResizeHandleProps<TData>) {
  const [isFocused, setIsFocused] = useState(false);

  // TanStack's native resize handler - stable ref to avoid stale closures
  const resizeHandlerRef = useStableValue(header.getResizeHandler());
  const isResizing = header.column.getIsResizing();

  // Stable refs for callbacks to avoid stale closures in useDrag
  const onResizeEndRef = useStableValue(onResizeEnd);
  const onAutoFitRef = useStableValue(onAutoFit);
  const onResetRef = useStableValue(onReset);

  // ==========================================================================
  // Pointer Down - Start TanStack resize immediately
  // TanStack's handler sets up its own document-level listeners for tracking
  // ==========================================================================

  const handlePointerDown = useStableCallback((e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    // Start TanStack resize immediately - it handles all the tracking
    resizeHandlerRef.current(e.nativeEvent);
  });

  // ==========================================================================
  // Drag Gesture - only used to detect when resize ends
  // TanStack handles all the actual resize tracking
  // Uses refs to avoid stale closures (useDrag memoizes the handler)
  // ==========================================================================

  // ==========================================================================
  // Drag Gesture - only used to detect when resize ends
  // TanStack handles all the actual resize tracking
  // Uses refs to avoid stale closures (useDrag memoizes the handler)
  // ==========================================================================

  const bindDrag = useDrag(
    ({ last, tap }) => {
      // Ignore taps (double-click handles those)
      if (tap) return;

      // When drag ends, notify parent for persistence
      if (last) {
        onResizeEndRef.current?.();
      }
    },
    {
      filterTaps: true,
      threshold: 3,
      pointer: { touch: true },
    },
  );

  // ==========================================================================
  // Click Events - Auto-fit and Reset
  // Using stable callbacks to avoid recreating on prop changes
  // ==========================================================================

  const handleDoubleClick = useStableCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (e.shiftKey) {
      onResetRef.current?.(header.id);
    } else {
      onAutoFitRef.current?.(header.id);
    }
  });

  // Keyboard support for accessibility
  const handleKeyDown = useStableCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (e.shiftKey) {
        onResetRef.current?.(header.id);
      } else {
        onAutoFitRef.current?.(header.id);
      }
    }
  });

  // Merge pointer down: our handler (starts TanStack resize) + useDrag (tracks gesture)
  // We call bindDrag() inside the handler (not during render) to get fresh bindings
  const mergedPointerDown = useStableCallback((e: React.PointerEvent) => {
    handlePointerDown(e);
    // Get useDrag's pointer down handler and call it
    // This is called in an event handler, not during render
    bindDrag().onPointerDown?.(e);
  });

  // Get useDrag bindings to spread on element
  // Note: bindDrag() returns a new object each time, but useDrag internally
  // memoizes the handlers, so this is safe for React reconciliation
  const dragBindProps = bindDrag();

  return (
    <div
      {...dragBindProps}
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
      onPointerDown={mergedPointerDown}
      onDoubleClick={handleDoubleClick}
      onKeyDown={handleKeyDown}
      onFocus={() => setIsFocused(true)}
      onBlur={() => setIsFocused(false)}
      role="separator"
      aria-orientation="vertical"
      aria-label={`Resize ${header.id} column. Double-click to auto-fit, Shift+double-click to reset.`}
      tabIndex={0}
    />
  );
}

// Memo with generic support
export const ResizeHandle = memo(ResizeHandleInner) as <TData>(props: ResizeHandleProps<TData>) => React.ReactElement;
