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
 * Section Navigation Hook
 *
 * Generic hook for tracking section visibility and providing navigation
 * in tables with grouped/sectioned data. Enables:
 *
 * - Tracking which sections are visible vs scrolled out of view
 * - Smooth scrolling to any section
 * - Bottom section stack navigation (for sections scrolled past)
 *
 * This is a generic utility - domain-specific styling and rendering
 * should be handled by the consuming component.
 */

"use client";

import { useRef, useState, useLayoutEffect, useCallback, useMemo } from "react";

// =============================================================================
// Types
// =============================================================================

/**
 * Minimal section info needed for navigation.
 * Consumers can extend with domain-specific metadata.
 */
export interface SectionNavItem {
  /** Unique section identifier */
  id: string;
  /** Display label for the section */
  label: string;
  /** Number of items in this section */
  itemCount: number;
}

export interface UseSectionNavigationOptions {
  /** Section metadata (id, label, count) */
  sections: SectionNavItem[];
  /** Height of the table header in pixels */
  headerHeight: number;
  /** Height of each section header in pixels */
  sectionHeight: number;
  /** Height of each data row in pixels */
  rowHeight: number;
}

export interface UseSectionNavigationResult {
  /** Ref to attach to the scroll container */
  scrollRef: React.RefObject<HTMLDivElement | null>;
  /** Indices of sections that have scrolled past the viewport (for bottom stack) */
  hiddenSectionIndices: number[];
  /** Scroll to a specific section by index */
  scrollToSection: (sectionIndex: number) => void;
  /** Get the CSS sticky top position for a section by index */
  getSectionStickyTop: (sectionIndex: number) => number;
}

// =============================================================================
// Hook
// =============================================================================

export function useSectionNavigation({
  sections,
  headerHeight,
  sectionHeight,
  rowHeight,
}: UseSectionNavigationOptions): UseSectionNavigationResult {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [rawHiddenIndices, setRawHiddenIndices] = useState<number[]>([]);

  // Calculate starting position of each section
  const sectionStartPositions = useMemo(() => {
    const positions: number[] = [];
    let currentPosition = headerHeight;

    for (let i = 0; i < sections.length; i++) {
      positions.push(currentPosition);
      currentPosition += sectionHeight;
      currentPosition += sections[i].itemCount * rowHeight;
    }

    return positions;
  }, [sections, rowHeight, headerHeight, sectionHeight]);

  // Calculate which sections are hidden (scrolled past viewport)
  const calculateHiddenIndices = useCallback(() => {
    const scrollContainer = scrollRef.current;
    if (!scrollContainer || sections.length === 0) return [];

    const scrollTop = scrollContainer.scrollTop;
    const viewportHeight = scrollContainer.clientHeight;
    const visualPositions = sectionStartPositions.map((pos) => pos - scrollTop);
    const hidden: number[] = [];

    // Check sections from bottom to top
    for (let i = sections.length - 1; i >= 0; i--) {
      const sectionVisualTop = visualPositions[i];
      const stackTopPosition = viewportHeight - (hidden.length + 1) * sectionHeight;
      if (sectionVisualTop >= stackTopPosition) {
        hidden.unshift(i);
      }
    }

    return hidden;
  }, [sections.length, sectionStartPositions, sectionHeight]);

  // Helper to compare arrays for equality
  const arraysEqual = useCallback((a: number[], b: number[]) => {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) return false;
    }
    return true;
  }, []);

  // Track scroll position and update hidden sections
  useLayoutEffect(() => {
    const scrollContainer = scrollRef.current;
    if (!scrollContainer || sections.length === 0) {
      // Don't call setState synchronously - empty array is the initial state
      // and the useMemo filter handles any stale indices
      return;
    }

    const handleScroll = () => {
      const newIndices = calculateHiddenIndices();
      setRawHiddenIndices((prev) => (arraysEqual(prev, newIndices) ? prev : newIndices));
    };

    // Defer initial calculation to avoid synchronous setState in effect
    // requestAnimationFrame ensures we're past the synchronous effect phase
    const frameId = requestAnimationFrame(handleScroll);

    scrollContainer.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      cancelAnimationFrame(frameId);
      scrollContainer.removeEventListener("scroll", handleScroll);
    };
  }, [sections.length, calculateHiddenIndices, arraysEqual]);

  // Filter indices to ensure they're always valid for current sections
  const hiddenSectionIndices = useMemo(
    () => rawHiddenIndices.filter((i) => i >= 0 && i < sections.length),
    [rawHiddenIndices, sections.length],
  );

  // Smooth scroll animation
  const smoothScrollTo = useCallback((element: HTMLElement, targetTop: number) => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      element.scrollTop = targetTop;
      return;
    }

    const startTop = element.scrollTop;
    const distance = targetTop - startTop;
    const duration = 150;
    let startTime: number | null = null;
    const easeOutQuad = (t: number) => t * (2 - t);

    const animate = (currentTime: number) => {
      if (!startTime) startTime = currentTime;
      const elapsed = currentTime - startTime;
      const progress = Math.min(elapsed / duration, 1);
      element.scrollTop = startTop + distance * easeOutQuad(progress);
      if (progress < 1) requestAnimationFrame(animate);
    };

    requestAnimationFrame(animate);
  }, []);

  // Scroll to a specific section
  const scrollToSection = useCallback(
    (sectionIndex: number) => {
      const scrollContainer = scrollRef.current;
      if (!scrollContainer || sectionIndex >= sections.length) return;

      // Calculate how much header space we need above
      const stackedHeadersHeight = headerHeight + (sectionIndex + 1) * sectionHeight;
      let contentBeforeFirstRow = headerHeight;

      for (let i = 0; i < sectionIndex; i++) {
        contentBeforeFirstRow += sectionHeight + sections[i].itemCount * rowHeight;
      }
      contentBeforeFirstRow += sectionHeight;

      smoothScrollTo(scrollContainer, Math.max(0, contentBeforeFirstRow - stackedHeadersHeight));
    },
    [sections, rowHeight, smoothScrollTo, headerHeight, sectionHeight],
  );

  // Get sticky top position for a section header
  const getSectionStickyTop = useCallback(
    (sectionIndex: number) => {
      return headerHeight + sectionIndex * sectionHeight;
    },
    [headerHeight, sectionHeight],
  );

  return {
    scrollRef,
    hiddenSectionIndices,
    scrollToSection,
    getSectionStickyTop,
  };
}
