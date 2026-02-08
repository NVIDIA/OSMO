/**
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION. All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * SPDX-License-Identifier: Apache-2.0
 */

"use client";

import { memo } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { cn } from "@/lib/utils";
import { useMounted } from "@/hooks/use-mounted";
import type { SortableCellProps } from "@/components/data-table/types";

/**
 * Drag-and-drop enabled header cell.
 *
 * Wraps content in a sortable container with drag handles and visual feedback.
 * Used for optional (reorderable) columns in the table header.
 *
 * Note: We use useMounted to delay applying dnd-kit attributes until after
 * hydration to prevent SSR/client mismatch on aria-describedby IDs.
 */
export const SortableCell = memo(function SortableCell({
  id,
  children,
  className,
  as: Component = "div",
  width: cssVarWidth,
  colIndex,
}: SortableCellProps) {
  const mounted = useMounted();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });

  // Style uses CSS variable width; minWidth and flexShrink prevent size jitter during drag
  const style: React.CSSProperties = {
    transform: transform ? `translate3d(${transform.x}px, 0, 0)` : undefined,
    transition,
    zIndex: isDragging ? 10 : undefined,
    opacity: isDragging ? 0.8 : 1,
    width: cssVarWidth,
    minWidth: cssVarWidth,
    flexShrink: 0, // Prevent shrinking below specified width
  };

  // Accessibility attributes for header cells
  const accessibilityProps =
    Component === "th"
      ? { scope: "col" as const, "aria-colindex": colIndex }
      : { role: "columnheader" as const, "aria-colindex": colIndex };

  // Only apply dnd-kit attributes after hydration to prevent SSR mismatch
  // on aria-describedby (dnd-kit generates different IDs on server vs client)
  const dndAttributes = mounted ? attributes : {};
  const dndListeners = mounted ? listeners : {};

  return (
    <Component
      ref={setNodeRef}
      data-column-id={id}
      {...dndAttributes}
      {...dndListeners}
      {...accessibilityProps}
      style={style}
      className={cn(
        "cursor-grab active:cursor-grabbing",
        isDragging && "rounded bg-zinc-200 shadow-md ring-1 ring-zinc-300 dark:bg-zinc-700 dark:ring-zinc-600",
        className,
      )}
    >
      {children}
    </Component>
  );
});
