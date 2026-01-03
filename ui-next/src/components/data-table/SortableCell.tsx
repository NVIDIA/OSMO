/**
 * Copyright (c) 2026, NVIDIA CORPORATION. All rights reserved.
 *
 * NVIDIA CORPORATION and its licensors retain all intellectual property
 * and proprietary rights in and to this software, related documentation
 * and any modifications thereto. Any use, reproduction, disclosure or
 * distribution of this software and related documentation without an express
 * license agreement from NVIDIA CORPORATION is strictly prohibited.
 */

"use client";

import { memo } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { cn } from "@/lib/utils";
import type { SortableCellProps } from "./types";

/**
 * Drag-and-drop enabled header cell.
 *
 * Wraps content in a sortable container with drag handles and visual feedback.
 * Used for optional (reorderable) columns in the table header.
 */
export const SortableCell = memo(function SortableCell({
  id,
  children,
  className,
  as: Component = "div",
  width: propWidth,
}: SortableCellProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
    node,
  } = useSortable({ id });

  // Get current width to maintain during drag, or use prop width
  const currentWidth = node.current?.offsetWidth;
  const width = isDragging && currentWidth ? currentWidth : propWidth;

  const style: React.CSSProperties = {
    transform: transform ? `translate3d(${transform.x}px, 0, 0)` : undefined,
    transition,
    zIndex: isDragging ? 10 : undefined,
    opacity: isDragging ? 0.8 : 1,
    width,
    minWidth: propWidth,
    maxWidth: propWidth,
  };

  return (
    <Component
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      role={Component === "th" ? undefined : "columnheader"}
      style={style}
      className={cn(
        "cursor-grab active:cursor-grabbing",
        isDragging &&
          "rounded bg-zinc-200 shadow-md ring-1 ring-zinc-300 dark:bg-zinc-700 dark:ring-zinc-600",
        className,
      )}
    >
      {children}
    </Component>
  );
});
