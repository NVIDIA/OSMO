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

/**
 * Table DnD Hook
 *
 * Provides DnD sensors and modifiers for column reordering.
 * Extracted from pools-table and resources-table implementations.
 *
 * Constraints:
 * - Horizontal movement only (no vertical)
 * - Bounded to table header (no continuous expansion)
 * - No auto-scroll (user must manually scroll to access off-screen columns)
 */

import { useMemo } from "react";
import { useSensor, useSensors, PointerSensor, KeyboardSensor, type Modifier } from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";

/**
 * Modifier that restricts drag movement to horizontal axis only.
 * Prevents vertical movement and scaling during column reorder.
 */
export const restrictToHorizontalAxis: Modifier = ({ transform }) => ({
  ...transform,
  y: 0,
  scaleX: 1,
  scaleY: 1,
});

/**
 * Modifier that restricts drag to within the parent container bounds.
 * Prevents dragging columns beyond the table header width.
 */
export const restrictToParentBounds: Modifier = ({ transform, draggingNodeRect, containerNodeRect }) => {
  if (!draggingNodeRect || !containerNodeRect) {
    return transform;
  }

  // Calculate bounds
  const minX = containerNodeRect.left - draggingNodeRect.left;
  const maxX = containerNodeRect.right - draggingNodeRect.right;

  // Clamp transform to bounds
  return {
    ...transform,
    x: Math.min(Math.max(transform.x, minX), maxX),
    y: 0, // Also enforce horizontal-only
    scaleX: 1,
    scaleY: 1,
  };
};

/**
 * Auto-scroll configuration for DndContext.
 * Set to false to prevent table from auto-scrolling during column drag.
 *
 * @example
 * ```tsx
 * <DndContext autoScroll={AUTO_SCROLL_CONFIG}>
 * ```
 */
export const AUTO_SCROLL_CONFIG = false;

/**
 * Hook for table column DnD setup.
 *
 * Returns sensors configured for pointer and keyboard interaction,
 * plus modifiers that constrain movement to horizontal axis within bounds.
 *
 * @param options.enableBoundsRestriction - If true, restricts drag to parent bounds (default: true)
 *
 * @example
 * ```tsx
 * const { sensors, modifiers } = useTableDnd();
 *
 * <DndContext
 *   sensors={sensors}
 *   modifiers={modifiers}
 *   collisionDetection={closestCenter}
 *   onDragEnd={handleDragEnd}
 *   autoScroll={false} // IMPORTANT: Disable auto-scroll
 * >
 *   <SortableContext items={columnIds}>
 *     {columns.map(...)}
 *   </SortableContext>
 * </DndContext>
 * ```
 */
/**
 * Check if an element or any of its ancestors has `data-no-dnd="true"`.
 * Used to prevent DnD activation on resize handles and other non-draggable elements.
 */
function hasNoDndAncestor(element: Element | null): boolean {
  let current = element;
  while (current) {
    if (current.getAttribute?.("data-no-dnd") === "true") {
      return true;
    }
    current = current.parentElement;
  }
  return false;
}

/**
 * Custom PointerSensor that respects `data-no-dnd="true"` attribute.
 * Extends the default PointerSensor to skip drag activation on resize handles.
 */
class NoDndPointerSensor extends PointerSensor {
  static activators = [
    {
      eventName: "onPointerDown" as const,
      handler: ({ nativeEvent: event }: { nativeEvent: PointerEvent }) => {
        // Don't activate if the target or its ancestors have data-no-dnd="true"
        if (hasNoDndAncestor(event.target as Element)) {
          return false;
        }
        // Only activate on primary button (left click)
        if (event.button !== 0) {
          return false;
        }
        return true;
      },
    },
  ];
}

export function useTableDnd(options?: { enableBoundsRestriction?: boolean }) {
  const { enableBoundsRestriction = true } = options ?? {};

  const sensors = useSensors(
    useSensor(NoDndPointerSensor, {
      activationConstraint: {
        // Require 5px movement before starting drag
        // Prevents accidental drags on click
        distance: 5,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  // Memoize modifiers array to avoid recreation
  // Use bounds restriction by default to prevent dragging beyond table width
  const modifiers = useMemo(
    () =>
      enableBoundsRestriction
        ? [restrictToParentBounds] // Includes horizontal restriction
        : [restrictToHorizontalAxis], // Just horizontal
    [enableBoundsRestriction],
  );

  return {
    sensors,
    modifiers,
    /**
     * Pass this to DndContext autoScroll prop to disable auto-scrolling.
     * Prevents table from expanding/scrolling when dragging near edges.
     */
    autoScrollConfig: AUTO_SCROLL_CONFIG,
  };
}
