/**
 * Copyright (c) 2026, NVIDIA CORPORATION. All rights reserved.
 *
 * NVIDIA CORPORATION and its licensors retain all intellectual property
 * and proprietary rights in and to this software, related documentation
 * and any modifications thereto. Any use, reproduction, disclosure or
 * distribution of this software and related documentation without an express
 * license agreement from NVIDIA CORPORATION is strictly prohibited.
 */

import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import type { RefObject } from "react";

/**
 * Layout dimensions for chip width estimation.
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

export interface UseExpandableChipsOptions {
  /** Array of items to display as chips */
  items: string[];
  /** Layout dimensions for width calculation */
  layout: ChipLayoutDimensions;
  /** Whether chips should be sorted alphabetically (default: true) */
  sortAlphabetically?: boolean;
}

export interface UseExpandableChipsResult {
  /** Ref to attach to the container element */
  containerRef: RefObject<HTMLDivElement | null>;
  /** Whether the list is currently expanded */
  expanded: boolean;
  /** Toggle expansion state */
  setExpanded: (expanded: boolean) => void;
  /** Number of items visible when collapsed */
  visibleCount: number;
  /** Items to display (sorted if sortAlphabetically is true) */
  sortedItems: string[];
  /** Items currently displayed based on expansion state */
  displayedItems: string[];
  /** Number of items hidden in overflow */
  overflowCount: number;
}

/**
 * Hook for expandable chip lists.
 *
 * Handles width estimation, ResizeObserver, expand/collapse state,
 * and overflow calculation. Used for displaying tags, platforms,
 * sharing groups, etc. in constrained spaces.
 *
 * @example
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
 */
export function useExpandableChips({
  items,
  layout,
  sortAlphabetically = true,
}: UseExpandableChipsOptions): UseExpandableChipsResult {
  const [expanded, setExpanded] = useState(false);
  const [visibleCount, setVisibleCount] = useState(1);
  const containerRef = useRef<HTMLDivElement>(null);

  // Sort items if requested
  const sortedItems = useMemo(
    () => (sortAlphabetically ? [...items].sort((a, b) => a.localeCompare(b)) : items),
    [items, sortAlphabetically]
  );

  // Estimate chip width based on text length
  const estimateChipWidth = useCallback(
    (text: string) => text.length * layout.charWidth + layout.chipPadding,
    [layout.charWidth, layout.chipPadding]
  );

  // Calculate how many chips fit in available width
  const calculateVisibleCount = useCallback(() => {
    if (!containerRef.current || sortedItems.length === 0) return 1;

    const containerWidth = containerRef.current.offsetWidth;
    if (containerWidth === 0) return 1;

    // Account for container padding if specified
    const availableWidth = containerWidth - layout.containerPadding;

    let usedWidth = 0;
    let count = 0;
    const hasOverflow = sortedItems.length > 1;

    for (let i = 0; i < sortedItems.length; i++) {
      const chipWidth = estimateChipWidth(sortedItems[i]);
      const needsOverflowSpace = hasOverflow && i < sortedItems.length - 1;
      const requiredWidth = usedWidth + chipWidth + (count > 0 ? layout.chipGap : 0);
      const reservedForOverflow = needsOverflowSpace
        ? layout.overflowButtonWidth + layout.chipGap
        : 0;

      if (requiredWidth + reservedForOverflow <= availableWidth) {
        usedWidth = requiredWidth;
        count++;
      } else {
        break;
      }
    }

    // Always show at least 1 chip
    return Math.max(1, count);
  }, [sortedItems, estimateChipWidth, layout]);

  // Recalculate on resize with requestAnimationFrame debouncing
  useEffect(() => {
    if (expanded) return;

    const container = containerRef.current;
    if (!container) return;

    let rafId: number | null = null;

    const observer = new ResizeObserver(() => {
      // Cancel pending frame to debounce rapid resize events
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
