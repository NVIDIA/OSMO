/**
 * Copyright (c) 2025, NVIDIA CORPORATION. All rights reserved.
 *
 * NVIDIA CORPORATION and its licensors retain all intellectual property
 * and proprietary rights in and to this software, related documentation
 * and any modifications thereto. Any use, reproduction, disclosure or
 * distribution of this software and related documentation without an express
 * license agreement from NVIDIA CORPORATION is strictly prohibited.
 */

/**
 * Performance optimization utilities.
 *
 * These utilities help reduce reflow, optimize rendering, and improve perceived performance.
 */

import { useCallback, useEffect, useRef, useState } from "react";

// =============================================================================
// Debouncing
// =============================================================================

/**
 * Debounce a value - useful for search inputs.
 * Returns the debounced value after the specified delay.
 *
 * @example
 * const [search, setSearch] = useState("");
 * const debouncedSearch = useDebounce(search, 300);
 * // Use debouncedSearch for API calls
 */
export function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    return () => {
      clearTimeout(timer);
    };
  }, [value, delay]);

  return debouncedValue;
}

/**
 * Debounce a callback function.
 * Returns a stable debounced function that won't change between renders.
 *
 * @example
 * const handleSearch = useDebouncedCallback((query: string) => {
 *   fetchResults(query);
 * }, 300);
 */
export function useDebouncedCallback<T extends (...args: never[]) => unknown>(
  callback: T,
  delay: number,
): (...args: Parameters<T>) => void {
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const callbackRef = useRef(callback);

  // Update callback ref on each render
  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  return useCallback(
    (...args: Parameters<T>) => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      timeoutRef.current = setTimeout(() => {
        callbackRef.current(...args);
      }, delay);
    },
    [delay],
  );
}

// =============================================================================
// RAF (RequestAnimationFrame) Scheduling
// =============================================================================

/**
 * Schedule a callback to run on the next animation frame.
 * Useful for batching DOM reads/writes to prevent layout thrashing.
 *
 * @example
 * const scheduleUpdate = useRafCallback((value: number) => {
 *   element.style.transform = `translateY(${value}px)`;
 * });
 */
export function useRafCallback<T extends (...args: never[]) => unknown>(callback: T): (...args: Parameters<T>) => void {
  const rafRef = useRef<number | undefined>(undefined);
  const callbackRef = useRef(callback);

  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  useEffect(() => {
    return () => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
      }
    };
  }, []);

  return useCallback((...args: Parameters<T>) => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
    }
    rafRef.current = requestAnimationFrame(() => {
      callbackRef.current(...args);
    });
  }, []);
}

// =============================================================================
// Intersection Observer
// =============================================================================

/**
 * Hook for lazy-loading content when it enters the viewport.
 * Returns a ref to attach to the element and a boolean indicating visibility.
 *
 * @example
 * const [ref, isVisible] = useInView({ threshold: 0.1 });
 * return <div ref={ref}>{isVisible && <ExpensiveComponent />}</div>;
 */
export function useInView(options: IntersectionObserverInit = {}): [React.RefCallback<Element>, boolean] {
  const [isInView, setIsInView] = useState(false);
  const observerRef = useRef<IntersectionObserver | null>(null);
  const optionsRef = useRef(options);

  // Update options ref on each render
  useEffect(() => {
    optionsRef.current = options;
  }, [options]);

  const ref = useCallback((node: Element | null) => {
    // Cleanup previous observer
    if (observerRef.current) {
      observerRef.current.disconnect();
    }

    if (!node) return;

    // Create new observer
    observerRef.current = new IntersectionObserver(([entry]) => {
      setIsInView(entry.isIntersecting);
    }, optionsRef.current);

    observerRef.current.observe(node);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (observerRef.current) {
        observerRef.current.disconnect();
      }
    };
  }, []);

  return [ref, isInView];
}

// =============================================================================
// Layout Stability
// =============================================================================

/**
 * Measure an element's dimensions without causing reflow.
 * Uses ResizeObserver for efficient updates.
 *
 * @example
 * const [ref, dimensions] = useDimensions();
 * return <div ref={ref}>Width: {dimensions.width}</div>;
 */
export function useDimensions(): [React.RefCallback<HTMLElement>, { width: number; height: number }] {
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const observerRef = useRef<ResizeObserver | null>(null);

  const ref = useCallback((node: HTMLElement | null) => {
    if (observerRef.current) {
      observerRef.current.disconnect();
    }

    if (!node) return;

    observerRef.current = new ResizeObserver(([entry]) => {
      // Use borderBoxSize for accurate dimensions including padding/border
      const { inlineSize, blockSize } = entry.borderBoxSize[0];
      setDimensions({ width: inlineSize, height: blockSize });
    });

    observerRef.current.observe(node);
  }, []);

  useEffect(() => {
    return () => {
      if (observerRef.current) {
        observerRef.current.disconnect();
      }
    };
  }, []);

  return [ref, dimensions];
}

// =============================================================================
// Idle Callback
// =============================================================================

/**
 * Schedule low-priority work during browser idle time.
 * Falls back to setTimeout in unsupported browsers.
 *
 * @example
 * useIdleCallback(() => {
 *   // Analytics, prefetching, or other non-critical work
 *   sendAnalytics();
 * });
 */
export function useIdleCallback(callback: () => void, options: { timeout?: number } = {}): void {
  const callbackRef = useRef(callback);
  const timeoutValue = options.timeout;

  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  useEffect(() => {
    if ("requestIdleCallback" in window) {
      const id = window.requestIdleCallback(() => callbackRef.current(), { timeout: timeoutValue });
      return () => window.cancelIdleCallback(id);
    } else {
      // Fallback for Safari
      const id = setTimeout(() => callbackRef.current(), timeoutValue ?? 1);
      return () => clearTimeout(id);
    }
  }, [timeoutValue]);
}

// =============================================================================
// Scroll Performance
// =============================================================================

/**
 * Optimized scroll position tracking.
 * Uses passive listeners and RAF throttling.
 *
 * @example
 * const scrollY = useScrollPosition();
 * const isScrolled = scrollY > 100;
 */
export function useScrollPosition(element?: React.RefObject<HTMLElement>): number {
  const [scrollY, setScrollY] = useState(0);
  const rafRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    const target = element?.current ?? window;

    const handleScroll = () => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
      }
      rafRef.current = requestAnimationFrame(() => {
        const scrollTop = element?.current?.scrollTop ?? window.scrollY ?? window.pageYOffset;
        setScrollY(scrollTop);
      });
    };

    target.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      target.removeEventListener("scroll", handleScroll);
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
      }
    };
  }, [element]);

  return scrollY;
}

// =============================================================================
// Reduced Motion
// =============================================================================

/**
 * Check if user prefers reduced motion.
 * Useful for respecting accessibility preferences.
 *
 * @example
 * const prefersReducedMotion = usePrefersReducedMotion();
 * const animationDuration = prefersReducedMotion ? 0 : 300;
 */
export function usePrefersReducedMotion(): boolean {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  });

  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");

    const handleChange = (event: MediaQueryListEvent) => {
      setPrefersReducedMotion(event.matches);
    };

    mediaQuery.addEventListener("change", handleChange);
    return () => mediaQuery.removeEventListener("change", handleChange);
  }, []);

  return prefersReducedMotion;
}
