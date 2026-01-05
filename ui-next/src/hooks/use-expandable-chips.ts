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

import { useState, useMemo, useRef, useEffect, useCallback, useLayoutEffect } from "react";
import type { RefObject } from "react";

// =============================================================================
// Types
// =============================================================================

/**
 * Layout dimensions for chip width estimation (used when measureRef is not provided).
 */
export interface ChipLayoutDimensions {
  /** Width of the overflow button (e.g., "+3") */
  overflowButtonWidth: number;
  /** Gap between chips */
  chipGap: number;
  /** Horizontal padding inside each chip */
  chipPadding: number;
  /** Estimated width per character */
  charWidth: number;
  /** Padding around the container */
  containerPadding: number;
}

/**
 * Options for DOM-based measurement mode.
 * When provided, the hook uses actual rendered widths instead of estimation.
 */
export interface MeasuredModeOptions {
  /** Ref to a hidden container that renders all items for measurement */
  measureRef: RefObject<HTMLElement | null>;
  /** CSS selector to find measurable items within measureRef (default: "[data-measure-item]") */
  itemSelector?: string;
  /** Reserved width for label or prefix content */
  reservedWidth?: number;
}

export interface UseExpandableChipsOptions<T = string> {
  /** Array of items to display */
  items: T[];
  /**
   * Layout dimensions for width estimation.
   * Required when NOT using measured mode.
   */
  layout?: ChipLayoutDimensions;
  /**
   * DOM-based measurement options.
   * When provided, uses actual rendered widths instead of character estimation.
   * More accurate for complex items with icons, variable fonts, etc.
   */
  measured?: MeasuredModeOptions;
  /** Whether items should be sorted alphabetically (default: true for strings, false for objects) */
  sortAlphabetically?: boolean;
  /** Key extractor for non-string items (required for object items) */
  getKey?: (item: T) => string;
}

export interface UseExpandableChipsResult<T = string> {
  /** Ref to attach to the container element */
  containerRef: RefObject<HTMLDivElement | null>;
  /** Whether the list is currently expanded */
  expanded: boolean;
  /** Toggle expansion state */
  setExpanded: (expanded: boolean) => void;
  /** Number of items visible when collapsed */
  visibleCount: number;
  /** Items to display (sorted if sortAlphabetically is true) */
  sortedItems: T[];
  /** Items currently displayed based on expansion state */
  displayedItems: T[];
  /** Number of items hidden in overflow */
  overflowCount: number;
}

// =============================================================================
// Hook
// =============================================================================

/**
 * Hook for expandable chip/pill lists with responsive overflow.
 *
 * Supports two measurement modes:
 * 1. **Estimation mode** (default): Uses character count to estimate widths.
 *    Best for simple text chips with consistent styling.
 * 2. **Measured mode**: Uses actual DOM measurements from a hidden container.
 *    Best for complex items with icons, variable fonts, or dynamic styling.
 *
 * @example Estimation mode (simple text chips)
 * ```tsx
 * const { containerRef, displayedItems, overflowCount, expanded, setExpanded } =
 *   useExpandableChips({ items: platforms, layout: chipLayout });
 *
 * return (
 *   <div ref={containerRef}>
 *     {displayedItems.map(item => <Chip key={item}>{item}</Chip>)}
 *     {overflowCount > 0 && <button onClick={() => setExpanded(!expanded)}>+{overflowCount}</button>}
 *   </div>
 * );
 * ```
 *
 * @example Measured mode (complex items with icons)
 * ```tsx
 * const measureRef = useRef<HTMLDivElement>(null);
 * const { containerRef, displayedItems, overflowCount, expanded, setExpanded } =
 *   useExpandableChips({
 *     items: groups,
 *     measured: { measureRef, itemSelector: "[data-pill]", reservedWidth: 100 },
 *     getKey: (g) => g.name,
 *   });
 *
 * return (
 *   <div ref={containerRef}>
 *     <div ref={measureRef} className="invisible absolute">
 *       {items.map(g => <div key={g.name} data-pill><Pill group={g} /></div>)}
 *     </div>
 *     {displayedItems.map(g => <Pill key={g.name} group={g} />)}
 *   </div>
 * );
 * ```
 */
export function useExpandableChips<T = string>({
  items,
  layout,
  measured,
  sortAlphabetically,
  getKey,
}: UseExpandableChipsOptions<T>): UseExpandableChipsResult<T> {
  const [expanded, setExpanded] = useState(false);
  const [visibleCount, setVisibleCount] = useState(1);
  const containerRef = useRef<HTMLDivElement>(null);

  // Determine if we're in measured mode
  const isMeasuredMode = measured !== undefined;

  // Default sort behavior: true for strings, false for objects
  const shouldSort = sortAlphabetically ?? typeof items[0] === "string";

  // Sort items if requested
  const sortedItems = useMemo(() => {
    if (!shouldSort || items.length === 0) return items;

    // For strings, use localeCompare directly
    if (typeof items[0] === "string") {
      return [...items].sort((a, b) => (a as unknown as string).localeCompare(b as unknown as string));
    }

    // For objects, sort by key if getKey is provided
    if (getKey) {
      return [...items].sort((a, b) => getKey(a).localeCompare(getKey(b)));
    }

    return items;
  }, [items, shouldSort, getKey]);

  // ==========================================================================
  // Estimation Mode Calculation
  // ==========================================================================

  const estimateChipWidth = useCallback(
    (text: string) => {
      if (!layout) return 0;
      return text.length * layout.charWidth + layout.chipPadding;
    },
    [layout],
  );

  const calculateVisibleCountEstimated = useCallback(() => {
    if (!containerRef.current || sortedItems.length === 0 || !layout) return 1;

    const containerWidth = containerRef.current.offsetWidth;
    if (containerWidth === 0) return 1;

    const availableWidth = containerWidth - layout.containerPadding;

    let usedWidth = 0;
    let count = 0;
    const hasOverflow = sortedItems.length > 1;

    for (let i = 0; i < sortedItems.length; i++) {
      const item = sortedItems[i];
      const text = typeof item === "string" ? item : (getKey?.(item) ?? String(i));
      const chipWidth = estimateChipWidth(text);
      const needsOverflowSpace = hasOverflow && i < sortedItems.length - 1;
      const requiredWidth = usedWidth + chipWidth + (count > 0 ? layout.chipGap : 0);
      const reservedForOverflow = needsOverflowSpace ? layout.overflowButtonWidth + layout.chipGap : 0;

      if (requiredWidth + reservedForOverflow <= availableWidth) {
        usedWidth = requiredWidth;
        count++;
      } else {
        break;
      }
    }

    return Math.max(1, count);
  }, [sortedItems, estimateChipWidth, layout, getKey]);

  // ==========================================================================
  // Measured Mode Calculation
  // ==========================================================================

  const calculateVisibleCountMeasured = useCallback(() => {
    if (!containerRef.current || !measured?.measureRef.current || sortedItems.length === 0) {
      return 1;
    }

    const container = containerRef.current;
    const measureContainer = measured.measureRef.current;
    const selector = measured.itemSelector ?? "[data-measure-item]";
    const pills = measureContainer.querySelectorAll(selector);

    if (pills.length === 0) return 1;

    const containerRect = container.getBoundingClientRect();
    const reservedWidth = measured.reservedWidth ?? 0;
    const overflowButtonWidth = 60; // Space for "+N" button
    const gap = 8; // Typical gap between items
    const availableWidth = containerRect.width - reservedWidth - overflowButtonWidth;

    let totalWidth = 0;
    let count = 0;

    pills.forEach((pill, index) => {
      const pillRect = pill.getBoundingClientRect();
      const pillWidth = pillRect.width + (index > 0 ? gap : 0);

      if (totalWidth + pillWidth <= availableWidth) {
        totalWidth += pillWidth;
        count = index + 1;
      }
    });

    return Math.max(1, count);
  }, [sortedItems.length, measured]);

  // ==========================================================================
  // Unified Calculation
  // ==========================================================================

  const calculateVisibleCount = isMeasuredMode ? calculateVisibleCountMeasured : calculateVisibleCountEstimated;

  // Use useLayoutEffect for measured mode (needs DOM to be painted)
  // Use useEffect for estimation mode (no DOM dependency)
  const effectHook = isMeasuredMode ? useLayoutEffect : useEffect;

  effectHook(() => {
    if (expanded) return;

    const container = containerRef.current;
    if (!container) return;

    let rafId: number | null = null;

    const observer = new ResizeObserver(() => {
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
      }
      rafId = requestAnimationFrame(() => {
        setVisibleCount(calculateVisibleCount());
        rafId = null;
      });
    });

    observer.observe(container);
    setVisibleCount(calculateVisibleCount());

    return () => {
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
      }
      observer.disconnect();
    };
  }, [calculateVisibleCount, expanded, sortedItems]);

  // Reset to collapsed when items change
  useEffect(() => {
    setExpanded(false);
  }, [items]);

  const displayedItems = expanded ? sortedItems : sortedItems.slice(0, visibleCount);
  const overflowCount = sortedItems.length - visibleCount;

  return {
    containerRef,
    expanded,
    setExpanded,
    visibleCount,
    sortedItems,
    displayedItems,
    overflowCount,
  };
}
