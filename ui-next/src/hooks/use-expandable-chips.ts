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

import { useState, useMemo, useRef, useCallback } from "react";
import type { RefObject } from "react";
import { useRafCallback, useIsomorphicLayoutEffect } from "@react-hookz/web";
import { useResizeObserver, useEventCallback } from "usehooks-ts";
import { naturalCompare } from "@/lib/utils";

export interface UseExpandableChipsOptions<T = string> {
  items: T[];
  sortAlphabetically?: boolean;
  getKey?: (item: T) => string;
  /**
   * When true, defers the initial measurement until explicitly allowed.
   * Useful when the component is mounting during an animation to avoid
   * forced synchronous layout that can cause transform storms.
   */
  deferMeasurement?: boolean;
}

export interface UseExpandableChipsResult<T = string> {
  containerRef: RefObject<HTMLDivElement | null>;
  measureRef: RefObject<HTMLDivElement | null>;
  expanded: boolean;
  setExpanded: (expanded: boolean) => void;
  visibleCount: number;
  sortedItems: T[];
  displayedItems: T[];
  overflowCount: number;
}

function isStringArray<T>(items: T[]): items is (T & string)[] {
  return items.length > 0 && typeof items[0] === "string";
}

function getOverflowCharCount(overflow: number): number {
  return 1 + String(overflow).length;
}

// CSS-driven measurement with dynamic +N width. RAF-throttled for 60fps.
export function useExpandableChips<T = string>({
  items,
  sortAlphabetically,
  getKey,
  deferMeasurement = false,
}: UseExpandableChipsOptions<T>): UseExpandableChipsResult<T> {
  const [expandedState, setExpandedState] = useState<{ items: T[]; value: boolean }>({
    items,
    value: false,
  });

  const expanded = expandedState.items === items ? expandedState.value : false;

  const setExpanded = useEventCallback((value: boolean) => {
    setExpandedState({ items, value });
  });

  const [visibleCount, setVisibleCount] = useState(items.length);
  const containerRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const lastWidthRef = useRef(0);

  const shouldSort = sortAlphabetically ?? isStringArray(items);

  // Sort items using natural/alphanumeric sorting if requested
  const sortedItems = useMemo(() => {
    if (!shouldSort || items.length === 0) return items;
    if (isStringArray(items)) {
      return [...items].sort((a, b) => naturalCompare(a, b));
    }
    if (getKey) {
      return [...items].sort((a, b) => naturalCompare(getKey(a), getKey(b)));
    }
    return items;
  }, [items, shouldSort, getKey]);

  const calculateVisibleCount = useCallback(() => {
    const container = containerRef.current;
    const measure = measureRef.current;
    const itemCount = sortedItems.length;

    if (!container || !measure || itemCount === 0) {
      return itemCount;
    }

    const containerWidth = container.offsetWidth;
    if (containerWidth === 0) return itemCount;

    const computedStyle = getComputedStyle(measure);
    const gap = parseFloat(computedStyle.gap) || 0;

    // Get all chip elements and read their widths in one pass
    const chips = measure.querySelectorAll<HTMLElement>("[data-chip]");
    if (chips.length === 0) return itemCount;

    const chipWidths: number[] = [];
    for (let i = 0; i < chips.length; i++) {
      chipWidths.push(chips[i].offsetWidth);
    }

    const overflowBtn = measure.querySelector<HTMLElement>("[data-overflow]");
    const baseOverflowWidth = overflowBtn?.offsetWidth || 0;
    const baseCharCount = 2;
    const charWidth = baseOverflowWidth / (baseCharCount + 1.5);

    let accumulatedWidth = 0;
    let count = 0;

    for (let i = 0; i < chipWidths.length; i++) {
      const chipWidth = chipWidths[i];
      const gapWidth = count > 0 ? gap : 0;
      const isLast = i === chipWidths.length - 1;
      const potentialOverflow = itemCount - (i + 1);

      let overflowReserve = 0;
      if (!isLast && potentialOverflow > 0) {
        const overflowCharCount = getOverflowCharCount(potentialOverflow);
        const charDiff = overflowCharCount - baseCharCount;
        const dynamicOverflowWidth = baseOverflowWidth + charDiff * charWidth;
        overflowReserve = dynamicOverflowWidth + gap;
      }

      if (accumulatedWidth + gapWidth + chipWidth + overflowReserve <= containerWidth) {
        accumulatedWidth += gapWidth + chipWidth;
        count++;
      } else {
        break;
      }
    }

    return Math.max(1, count);
  }, [sortedItems]);

  const [scheduleRecalculate] = useRafCallback(() => {
    setVisibleCount(calculateVisibleCount());
  });

  // Schedule calculation via RAF to avoid forced synchronous layout during
  // panel opening animation. The RAF callback defers the measurement by one
  // frame, which is invisible to the user since the content wrapper starts
  // at opacity: 0 during the entering animation.
  //
  // When deferMeasurement is true (during panel entering phase), skip the
  // measurement entirely to prevent layout thrashing during GPU animations.
  useIsomorphicLayoutEffect(() => {
    if (!deferMeasurement) {
      // Always recalculate to keep overflowCount accurate for "show less" button
      scheduleRecalculate();
    }
  }, [scheduleRecalculate, expanded, deferMeasurement]);

  useResizeObserver({
    ref: containerRef as RefObject<HTMLElement>,
    onResize: () => {
      // Skip resize recalculation during deferred measurement phase to avoid
      // layout thrashing during the initial mount animation
      if (!deferMeasurement) {
        // Filter subpixel jitter: Only recalculate if width changed by more than 2px.
        // This prevents compositor-induced subpixel changes from triggering unnecessary
        // chip recalculation when the panel opens (e.g., backdrop-filter effects).
        const container = containerRef.current;
        if (container) {
          const currentWidth = container.offsetWidth;
          const widthDelta = Math.abs(currentWidth - lastWidthRef.current);
          if (widthDelta > 2) {
            lastWidthRef.current = currentWidth;
            scheduleRecalculate();
          }
        }
      }
    },
    box: "border-box",
  });

  const displayedItems = expanded ? sortedItems : sortedItems.slice(0, visibleCount);
  const overflowCount = sortedItems.length - visibleCount;

  return {
    containerRef,
    measureRef,
    expanded,
    setExpanded,
    visibleCount,
    sortedItems,
    displayedItems,
    overflowCount,
  };
}
