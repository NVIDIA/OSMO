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
import { useRafCallback } from "./use-raf-callback";
import { useIsomorphicLayoutEffect } from "./use-isomorphic-layout-effect";
import { useStableCallback } from "./use-stable-callback";

// =============================================================================
// Types
// =============================================================================

export interface UseExpandableChipsOptions<T = string> {
  /** Array of items to display */
  items: T[];
  /** Whether items should be sorted alphabetically (default: true for strings) */
  sortAlphabetically?: boolean;
  /** Key extractor for non-string items */
  getKey?: (item: T) => string;
}

export interface UseExpandableChipsResult<T = string> {
  /** Ref for the visible container */
  containerRef: RefObject<HTMLDivElement | null>;
  /** Ref for the hidden measurement container */
  measureRef: RefObject<HTMLDivElement | null>;
  /** Whether the list is currently expanded */
  expanded: boolean;
  /** Toggle expansion state */
  setExpanded: (expanded: boolean) => void;
  /** Number of items visible when collapsed */
  visibleCount: number;
  /** Sorted items array */
  sortedItems: T[];
  /** Items currently displayed based on expansion state */
  displayedItems: T[];
  /** Number of items hidden in overflow */
  overflowCount: number;
}

// =============================================================================
// Helpers
// =============================================================================

function isStringArray<T>(items: T[]): items is (T & string)[] {
  return items.length > 0 && typeof items[0] === "string";
}

/**
 * Get the number of characters in "+N" for a given overflow count.
 * Used to estimate overflow button width dynamically.
 */
function getOverflowCharCount(overflow: number): number {
  // "+1" = 2 chars, "+10" = 3 chars, "+100" = 4 chars
  return 1 + String(overflow).length;
}

// =============================================================================
// Hook
// =============================================================================

/**
 * Hook for expandable chip/pill lists with responsive overflow.
 *
 * Uses CSS-driven measurement with dynamic +N width calculation.
 * Optimized for 60fps performance with batched DOM reads and RAF throttling.
 */
export function useExpandableChips<T = string>({
  items,
  sortAlphabetically,
  getKey,
}: UseExpandableChipsOptions<T>): UseExpandableChipsResult<T> {
  // Keyed expanded state - uses items reference as key
  // When items changes (new array), expanded auto-resets to false
  const [expandedState, setExpandedState] = useState<{ items: T[]; value: boolean }>({
    items,
    value: false,
  });

  // Derive actual expanded value - if items reference changed, reset to false
  const expanded = expandedState.items === items ? expandedState.value : false;

  // Stable setter that updates with current items reference
  const setExpanded = useStableCallback((value: boolean) => {
    setExpandedState({ items, value });
  });

  const [visibleCount, setVisibleCount] = useState(items.length);
  const containerRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);

  const shouldSort = sortAlphabetically ?? isStringArray(items);

  // Sort items alphabetically if requested
  const sortedItems = useMemo(() => {
    if (!shouldSort || items.length === 0) return items;
    if (isStringArray(items)) {
      return [...items].sort((a, b) => a.localeCompare(b));
    }
    if (getKey) {
      return [...items].sort((a, b) => getKey(a).localeCompare(getKey(b)));
    }
    return items;
  }, [items, shouldSort, getKey]);

  // ==========================================================================
  // CSS-Driven Measurement with Dynamic +N Calculation
  // ==========================================================================

  const calculateVisibleCount = useCallback(() => {
    const container = containerRef.current;
    const measure = measureRef.current;
    const itemCount = sortedItems.length;

    if (!container || !measure || itemCount === 0) {
      return itemCount;
    }

    // === BATCH ALL DOM READS FIRST (avoid layout thrashing) ===
    const containerWidth = container.offsetWidth;
    if (containerWidth === 0) return itemCount;

    const computedStyle = getComputedStyle(measure);
    const gap = parseFloat(computedStyle.gap) || 0;

    // Get all chip elements and read their widths in one pass
    const chips = measure.querySelectorAll<HTMLElement>("[data-chip]");
    if (chips.length === 0) return itemCount;

    // Pre-read all chip widths into array (single layout pass)
    const chipWidths: number[] = [];
    for (let i = 0; i < chips.length; i++) {
      chipWidths.push(chips[i].offsetWidth);
    }

    // Read overflow button measurements
    // We measure "+1" (2 chars) as baseline to calculate per-character width
    const overflowBtn = measure.querySelector<HTMLElement>("[data-overflow]");
    const baseOverflowWidth = overflowBtn?.offsetWidth || 0;
    const baseCharCount = 2; // "+1" = 2 characters
    // Estimate character width from the measured button
    // Button padding stays constant, only text width changes
    const charWidth = baseOverflowWidth / (baseCharCount + 1.5); // +1.5 accounts for padding ratio

    // === NOW CALCULATE (no more DOM reads) ===
    let accumulatedWidth = 0;
    let count = 0;

    for (let i = 0; i < chipWidths.length; i++) {
      const chipWidth = chipWidths[i];
      const gapWidth = count > 0 ? gap : 0;
      const isLast = i === chipWidths.length - 1;

      // Dynamic overflow calculation: if we stop here, overflow = remaining items
      const potentialOverflow = itemCount - (i + 1);

      // Calculate the actual overflow button width for this potential overflow count
      let overflowReserve = 0;
      if (!isLast && potentialOverflow > 0) {
        // Estimate overflow button width based on character count
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

  // RAF-throttled recalculation for smooth 60fps resize handling
  const [scheduleRecalculate] = useRafCallback<null>(() => {
    setVisibleCount(calculateVisibleCount());
  });

  // Observe container resize and recalculate
  useIsomorphicLayoutEffect(() => {
    if (expanded) return;

    const container = containerRef.current;
    if (!container) return;

    // Initial calculation
    setVisibleCount(calculateVisibleCount());

    // Observe resize with RAF throttling
    const observer = new ResizeObserver(() => scheduleRecalculate(null));
    observer.observe(container);

    return () => observer.disconnect();
  }, [calculateVisibleCount, expanded, scheduleRecalculate]);

  // ==========================================================================
  // Return (computed values, no DOM access)
  // ==========================================================================

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
