/**
 * Copyright (c) 2025, NVIDIA CORPORATION. All rights reserved.
 *
 * NVIDIA CORPORATION and its licensors retain all intellectual property
 * and proprietary rights in and to this software, related documentation
 * and any modifications thereto. Any use, reproduction, disclosure or
 * distribution of this software and related documentation without an express
 * license agreement from NVIDIA CORPORATION is strictly prohibited.
 */

import { useState, useEffect, useRef } from "react";

/**
 * Hook for auto-collapsing a controls panel based on available space.
 *
 * Automatically collapses when the controls panel exceeds a threshold
 * of the container height. Supports manual pin/unpin to override auto behavior.
 *
 * @param options Configuration options
 * @returns State and handlers for collapse behavior
 *
 * @example
 * ```tsx
 * const {
 *   containerRef,
 *   controlsRef,
 *   headerRef,
 *   isCollapsed,
 *   isPinned,
 *   toggleCollapse,
 *   togglePin,
 * } = useAutoCollapse({ threshold: 0.5 });
 * ```
 */
export function useAutoCollapse(
  options: {
    /** Threshold ratio (0-1) at which to auto-collapse. Default: 0.5 (50%) */
    threshold?: number;
    /** Fixed height of the header bar in pixels. Default: 41 */
    headerHeight?: number;
  } = {},
) {
  const { threshold = 0.5, headerHeight = 41 } = options;

  // Refs for measuring
  const containerRef = useRef<HTMLDivElement>(null);
  const controlsRef = useRef<HTMLDivElement>(null);
  const tableHeaderRef = useRef<HTMLDivElement>(null);

  // State
  const [autoCollapsed, setAutoCollapsed] = useState(false);
  const [isPinned, setIsPinned] = useState(false);
  const [pinnedState, setPinnedState] = useState(false);

  // Auto-collapse based on controls panel height vs container height
  useEffect(() => {
    const container = containerRef.current;
    const controls = controlsRef.current;
    const tableHeader = tableHeaderRef.current;
    if (!container || !controls || !tableHeader) return;

    let rafId: number;
    const measure = () => {
      const containerH = container.clientHeight;
      // Controls panel = header bar + controls content + table header
      const controlsPanelH = headerHeight + controls.scrollHeight + tableHeader.clientHeight;
      if (containerH > 0 && controlsPanelH > 0) {
        setAutoCollapsed(controlsPanelH > containerH * threshold);
      }
    };

    // Initial measurement
    rafId = requestAnimationFrame(measure);

    // Observe size changes
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(measure);
    });
    observer.observe(container);
    observer.observe(controls);

    return () => {
      cancelAnimationFrame(rafId);
      observer.disconnect();
    };
  }, [threshold, headerHeight]);

  // Effective collapsed: pinned state takes precedence
  const isCollapsed = isPinned ? pinnedState : autoCollapsed;

  // Toggle expand/collapse (pins if not already pinned)
  const toggleCollapse = () => {
    if (isPinned) {
      setPinnedState((prev) => !prev);
    } else {
      setIsPinned(true);
      setPinnedState(!autoCollapsed);
    }
  };

  // Toggle pin mode
  const togglePin = () => {
    if (!isPinned) setPinnedState(isCollapsed);
    setIsPinned(!isPinned);
  };

  return {
    // Refs to attach
    containerRef,
    controlsRef,
    tableHeaderRef,
    // State
    isCollapsed,
    isPinned,
    autoCollapsed,
    // Handlers
    toggleCollapse,
    togglePin,
  };
}
