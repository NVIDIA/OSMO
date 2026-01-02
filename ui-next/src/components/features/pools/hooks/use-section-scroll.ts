/**
 * Copyright (c) 2025, NVIDIA CORPORATION. All rights reserved.
 *
 * NVIDIA CORPORATION and its licensors retain all intellectual property
 * and proprietary rights in and to this software, related documentation
 * and any modifications thereto. Any use, reproduction, disclosure or
 * distribution of this software and related documentation without an express
 * license agreement from NVIDIA CORPORATION is strictly prohibited.
 */

import { useRef, useState, useLayoutEffect, useCallback, useMemo } from "react";
import type { StatusSection } from "./use-pool-sections";

interface UseSectionScrollOptions {
  sections: StatusSection[];
  headerHeight: number;
  sectionHeight: number;
  rowHeight: number;
}

export function useSectionScroll({ sections, headerHeight, sectionHeight, rowHeight }: UseSectionScrollOptions) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [rawHiddenIndices, setRawHiddenIndices] = useState<number[]>([]);

  const sectionStartPositions = useMemo(() => {
    const positions: number[] = [];
    let currentPosition = headerHeight;

    for (let i = 0; i < sections.length; i++) {
      positions.push(currentPosition);
      currentPosition += sectionHeight;
      currentPosition += sections[i].pools.length * rowHeight;
    }

    return positions;
  }, [sections, rowHeight, headerHeight, sectionHeight]);

  // Calculate hidden indices based on scroll position
  const calculateHiddenIndices = useCallback(() => {
    const scrollContainer = scrollRef.current;
    if (!scrollContainer || sections.length === 0) return [];

    const scrollTop = scrollContainer.scrollTop;
    const viewportHeight = scrollContainer.clientHeight;
    const visualPositions = sectionStartPositions.map((pos) => pos - scrollTop);
    const hidden: number[] = [];

    for (let i = sections.length - 1; i >= 0; i--) {
      const sectionVisualTop = visualPositions[i];
      const stackTopPosition = viewportHeight - (hidden.length + 1) * sectionHeight;
      if (sectionVisualTop >= stackTopPosition) {
        hidden.unshift(i);
      }
    }

    return hidden;
  }, [sections.length, sectionStartPositions, sectionHeight]);

  // useLayoutEffect runs synchronously after DOM mutations, before paint
  // This prevents the flash of stale state that useEffect would cause
  useLayoutEffect(() => {
    const scrollContainer = scrollRef.current;
    if (!scrollContainer) {
      setRawHiddenIndices([]);
      return;
    }

    if (sections.length === 0) {
      setRawHiddenIndices([]);
      return;
    }

    const handleScroll = () => {
      setRawHiddenIndices(calculateHiddenIndices());
    };

    // Calculate immediately on mount and when sections change
    handleScroll();

    scrollContainer.addEventListener("scroll", handleScroll, { passive: true });
    return () => scrollContainer.removeEventListener("scroll", handleScroll);
  }, [sections.length, calculateHiddenIndices]);

  // Filter indices to ensure they're always valid for current sections
  // This is a safety net in case of any timing issues
  const hiddenSectionIndices = useMemo(
    () => rawHiddenIndices.filter((i) => i >= 0 && i < sections.length),
    [rawHiddenIndices, sections.length],
  );

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

  const scrollToSection = useCallback(
    (sectionIndex: number) => {
      const scrollContainer = scrollRef.current;
      if (!scrollContainer || sectionIndex >= sections.length) return;

      const stackedHeadersHeight = headerHeight + (sectionIndex + 1) * sectionHeight;
      let contentBeforeFirstRow = headerHeight;

      for (let i = 0; i < sectionIndex; i++) {
        contentBeforeFirstRow += sectionHeight + sections[i].pools.length * rowHeight;
      }
      contentBeforeFirstRow += sectionHeight;

      smoothScrollTo(scrollContainer, Math.max(0, contentBeforeFirstRow - stackedHeadersHeight));
    },
    [sections, rowHeight, smoothScrollTo, headerHeight, sectionHeight],
  );

  return {
    scrollRef,
    hiddenSectionIndices,
    scrollToSection,
  };
}
