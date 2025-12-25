/**
 * Copyright (c) 2025, NVIDIA CORPORATION. All rights reserved.
 *
 * NVIDIA CORPORATION and its licensors retain all intellectual property
 * and proprietary rights in and to this software, related documentation
 * and any modifications thereto. Any use, reproduction, disclosure or
 * distribution of this software and related documentation without an express
 * license agreement from NVIDIA CORPORATION is strictly prohibited.
 */

import { useEffect, useRef } from "react";

/**
 * Hook for synchronizing horizontal scroll between a header and content area.
 *
 * When the content scrolls horizontally, the header follows.
 * Also tracks vertical scroll for shadow effects.
 *
 * @returns Refs and scroll state
 *
 * @example
 * ```tsx
 * const { headerRef, scrollRef, isScrolled } = useHorizontalScrollSync();
 *
 * <div ref={headerRef} className={isScrolled && "shadow-md"}>Header</div>
 * <div ref={scrollRef}>Content</div>
 * ```
 */
export function useHorizontalScrollSync() {
  const headerRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const scroll = scrollRef.current;
    const header = headerRef.current;
    if (!scroll) return;

    const handleScroll = () => {
      // Sync horizontal scroll (direct DOM, no React state)
      if (header) {
        header.scrollLeft = scroll.scrollLeft;
      }
    };

    scroll.addEventListener("scroll", handleScroll, { passive: true });
    return () => scroll.removeEventListener("scroll", handleScroll);
  }, []);

  return {
    headerRef,
    scrollRef,
  };
}

/**
 * Hook for tracking vertical scroll state.
 * Returns a state boolean for whether content is scrolled.
 *
 * @param scrollRef Ref to the scrollable container
 * @returns Whether the container is scrolled vertically
 */
export function useScrollShadow(scrollRef: React.RefObject<HTMLDivElement | null>) {
  const wasScrolledRef = useRef(false);
  const setIsScrolledRef = useRef<(value: boolean) => void>(() => {});

  useEffect(() => {
    const scroll = scrollRef.current;
    if (!scroll) return;

    const handleScroll = () => {
      const scrolled = scroll.scrollTop > 0;
      if (scrolled !== wasScrolledRef.current) {
        wasScrolledRef.current = scrolled;
        setIsScrolledRef.current(scrolled);
      }
    };

    scroll.addEventListener("scroll", handleScroll, { passive: true });
    return () => scroll.removeEventListener("scroll", handleScroll);
  }, [scrollRef]);

  // Return a hook-like interface
  return {
    setCallback: (fn: (value: boolean) => void) => {
      setIsScrolledRef.current = fn;
    },
    getIsScrolled: () => wasScrolledRef.current,
  };
}
