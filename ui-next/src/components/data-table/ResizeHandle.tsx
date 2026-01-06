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
 * Draggable handle for column resizing using TanStack Table's native APIs.
 *
 * @see https://tanstack.com/table/v8/docs/guide/column-sizing
 *
 * Features:
 * - Drag to resize (via TanStack's `header.getResizeHandler()`)
 * - Double-click to auto-fit content
 * - Shift + double-click to reset to proportional
 * - Keyboard accessible
 * - Touch support
 */

"use client";

import { memo, useCallback, useState } from "react";
import type { Header } from "@tanstack/react-table";
import { cn } from "@/lib/utils";

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

  // TanStack's native resize handler - works with mouse, touch, and pointer events
  // Memoize handler reference to avoid re-creating on each render
  const resizeHandler = header.getResizeHandler();
  
  // Only check isResizing when actually needed for styling
  // This getter can be expensive if called frequently
  const isResizing = header.column.getIsResizing();

  // Pointer events (modern, preferred)
  // stopPropagation prevents DnD sensors from picking up the resize drag
  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 0) return;
      e.stopPropagation();

      resizeHandler(e);

      const handlePointerUp = () => {
        onResizeEnd?.();
        document.removeEventListener("pointerup", handlePointerUp);
      };
      document.addEventListener("pointerup", handlePointerUp);
    },
    [resizeHandler, onResizeEnd],
  );

  // Mouse events (fallback for older browsers)
  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0) return;
      e.stopPropagation();

      resizeHandler(e);

      const handleMouseUp = () => {
        onResizeEnd?.();
        document.removeEventListener("mouseup", handleMouseUp);
      };
      document.addEventListener("mouseup", handleMouseUp);
    },
    [resizeHandler, onResizeEnd],
  );

  // Touch events (mobile)
  const handleTouchStart = useCallback(
    (e: React.TouchEvent) => {
      e.stopPropagation();

      resizeHandler(e);

      const handleTouchEnd = () => {
        onResizeEnd?.();
        document.removeEventListener("touchend", handleTouchEnd);
      };
      document.addEventListener("touchend", handleTouchEnd);
    },
    [resizeHandler, onResizeEnd],
  );

  // Double-click: auto-fit or reset
  const handleDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();

      if (e.shiftKey) {
        onReset?.(header.id);
      } else {
        onAutoFit?.(header.id);
      }
    },
    [header.id, onAutoFit, onReset],
  );

  // Keyboard support for accessibility
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        if (e.shiftKey) {
          onReset?.(header.id);
        } else {
          onAutoFit?.(header.id);
        }
      }
    },
    [header.id, onAutoFit, onReset],
  );

  return (
    <div
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
      onPointerDown={handlePointerDown}
      onMouseDown={handleMouseDown}
      onTouchStart={handleTouchStart}
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
