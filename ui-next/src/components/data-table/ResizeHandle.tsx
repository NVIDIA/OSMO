/**
 * Copyright (c) 2026, NVIDIA CORPORATION. All rights reserved.
 *
 * NVIDIA CORPORATION and its licensors retain all intellectual property
 * and proprietary rights in and to this software, related documentation
 * and any modifications thereto. Any use, reproduction, disclosure or
 * distribution of this software and related documentation without an express
 * license agreement from NVIDIA CORPORATION is strictly prohibited.
 */

/**
 * Resize Handle Component
 *
 * Draggable handle for column resizing.
 * Positioned at the right edge of column headers.
 *
 * Features:
 * - Drag to resize column
 * - Double-click to auto-fit content
 * - Shift + double-click to reset to proportional
 * - Prevents scrolling during drag
 * - Touch support via PointerEvents
 *
 * @see COLUMN_SIZING.md for design details
 */

"use client";

import { memo, useCallback, useState } from "react";
import { cn } from "@/lib/utils";

// =============================================================================
// Types
// =============================================================================

export interface ResizeHandleProps {
  /** Column ID this handle resizes */
  columnId: string;

  /** Whether resize is in progress (for any column) */
  isResizing?: boolean;

  /** Pointer down handler from useColumnResize */
  onPointerDown: (e: React.PointerEvent, columnId: string) => void;

  /** Pointer move handler from useColumnResize */
  onPointerMove: (e: React.PointerEvent) => void;

  /** Pointer up handler from useColumnResize */
  onPointerUp: (e: React.PointerEvent) => void;

  /** Pointer cancel handler from useColumnResize */
  onPointerCancel: (e: React.PointerEvent) => void;

  /** Double-click to auto-fit column */
  onAutoFit: (columnId: string) => void;

  /** Shift + double-click to reset column */
  onReset: (columnId: string) => void;
}

// =============================================================================
// Component
// =============================================================================

export const ResizeHandle = memo(function ResizeHandle({
  columnId,
  isResizing,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
  onAutoFit,
  onReset,
}: ResizeHandleProps) {
  const [isFocused, setIsFocused] = useState(false);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 0) return;
      onPointerDown(e, columnId);
    },
    [columnId, onPointerDown],
  );

  const handleDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();

      if (e.shiftKey) {
        onReset(columnId);
      } else {
        onAutoFit(columnId);
      }
    },
    [columnId, onAutoFit, onReset],
  );

  // Keyboard support for accessibility
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      switch (e.key) {
        case "Enter":
        case " ":
          e.preventDefault();
          if (e.shiftKey) {
            onReset(columnId);
          } else {
            onAutoFit(columnId);
          }
          break;
      }
    },
    [columnId, onAutoFit, onReset],
  );

  return (
    <div
      className={cn(
        "resize-handle",
        "absolute top-0 right-0 bottom-0 z-10",
        "w-2 cursor-col-resize",
        "touch-none select-none",
        // Visual indicator
        "after:absolute after:top-1/4 after:right-0.5 after:bottom-1/4 after:w-0.5",
        "after:rounded-full after:bg-transparent after:transition-colors",
        "hover:after:bg-zinc-400 dark:hover:after:bg-zinc-500",
        // Focus visible ring for keyboard navigation
        "focus-visible:outline-none focus-visible:after:bg-blue-500",
        // Active/resizing state
        (isResizing || isFocused) && "after:bg-zinc-500 dark:after:bg-zinc-400",
      )}
      onPointerDown={handlePointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onDoubleClick={handleDoubleClick}
      onKeyDown={handleKeyDown}
      onFocus={() => setIsFocused(true)}
      onBlur={() => setIsFocused(false)}
      role="separator"
      aria-orientation="vertical"
      aria-label={`Resize ${columnId} column. Press Enter to auto-fit, Shift+Enter to reset.`}
      aria-valuenow={undefined}
      tabIndex={0}
    />
  );
});
