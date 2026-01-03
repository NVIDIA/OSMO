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
 * Table DnD Hook
 *
 * Provides DnD sensors and modifiers for column reordering.
 * Extracted from pools-table and resources-table implementations.
 */

import { useMemo } from "react";
import {
  useSensor,
  useSensors,
  PointerSensor,
  KeyboardSensor,
  type Modifier,
} from "@dnd-kit/core";
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
 * Hook for table column DnD setup.
 *
 * Returns sensors configured for pointer and keyboard interaction,
 * plus the horizontal-only modifier.
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
 * >
 *   <SortableContext items={columnIds}>
 *     {columns.map(...)}
 *   </SortableContext>
 * </DndContext>
 * ```
 */
export function useTableDnd() {
  const sensors = useSensors(
    useSensor(PointerSensor, {
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
  const modifiers = useMemo(() => [restrictToHorizontalAxis], []);

  return {
    sensors,
    modifiers,
  };
}
