// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION. All rights reserved.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
//
// SPDX-License-Identifier: Apache-2.0

/**
 * useResizeDrag - Shared resize drag machinery for panel components.
 *
 * Handles:
 * - Drag state management
 * - Width calculation with clamping
 * - Text selection prevention during drag
 * - Optional RAF batching for smooth updates
 * - Snap zone integration callbacks
 */

import { useEffect, useRef, useMemo, type RefObject, type CSSProperties } from "react";
import { useBoolean, useEventCallback } from "usehooks-ts";
import { useDrag } from "@use-gesture/react";
import { useIsomorphicLayoutEffect } from "@react-hookz/web";

/** Selector for finding focusable elements within a container */
const FOCUSABLE_SELECTOR =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]):not([disabled])';

export interface UseResizeDragOptions {
  /** Current width as percentage (0-100) */
  width: number;
  /** Callback when width changes during resize */
  onWidthChange: (width: number) => void;
  /** Minimum width percentage */
  minWidth?: number;
  /** Maximum width percentage */
  maxWidth?: number;
  /** Minimum width in pixels (prevents too-narrow panels) */
  minWidthPx?: number;
  /** Maximum width in pixels (prevents too-wide panels) */
  maxWidthPx?: number;
  /** Container ref for calculating width percentages (if not provided, uses window.innerWidth) */
  containerRef?: RefObject<HTMLElement | null>;
  /**
   * Ref to the panel element. When provided, focus is restored to the panel
   * after a drag ends. This ensures focus-scoped escape key handling (usePanelEscape)
   * continues to work after resize operations.
   */
  panelRef?: RefObject<HTMLElement | null>;
  /** Use RAF batching for width updates (recommended for grid-based layouts) */
  batchWithRAF?: boolean;
  /** Called when drag starts (for snap zone integration) */
  onDragStart?: (initialPct?: number) => void;
  /** Called when drag ends (for snap zone integration) */
  onDragEnd?: () => void;
  /** Called when dragging state changes */
  onDraggingChange?: (isDragging: boolean) => void;
}

export interface UseResizeDragReturn {
  /** Whether currently dragging */
  isDragging: boolean;
  /** Props to spread on the resize handle - returns gesture handlers */
  bindResizeHandle: ReturnType<typeof useDrag>;
  /** Styles to apply to the panel during drag (willChange optimization) */
  dragStyles: CSSProperties;
}

/**
 * Hook that provides resize drag functionality for panels.
 *
 * @example
 * ```tsx
 * const containerRef = useRef<HTMLDivElement>(null);
 * const { isDragging, bindResizeHandle, dragStyles } = useResizeDrag({
 *   width: panelWidth,
 *   onWidthChange: setPanelWidth,
 *   minWidth: 20,
 *   maxWidth: 80,
 *   containerRef,
 * });
 * ```
 */
export function useResizeDrag({
  width,
  onWidthChange,
  minWidth = 20,
  maxWidth = 80,
  minWidthPx = 320,
  maxWidthPx = 0,
  containerRef,
  panelRef,
  batchWithRAF = false,
  onDragStart,
  onDragEnd,
  onDraggingChange,
}: UseResizeDragOptions): UseResizeDragReturn {
  // Drag state
  const { value: isDragging, setTrue: startDragging, setFalse: stopDragging } = useBoolean(false);

  // Store the width at drag start to calculate absolute new width from movement
  const startWidthRef = useRef(width);
  // Cache container width at drag start to avoid layout reflows during drag
  const containerWidthRef = useRef(0);

  // Refs that MUST be updated synchronously during render (not in effects!)
  // This is critical because useDrag's bounds() function can be called
  // during the same frame before any effects run, causing stale values.
  const widthRef = useRef(width);
  const minWidthRef = useRef(minWidth);
  const maxWidthRef = useRef(maxWidth);
  const minWidthPxRef = useRef(minWidthPx);
  const maxWidthPxRef = useRef(maxWidthPx);

  // RAF batching state (for SidePanel's grid coordination)
  const rafIdRef = useRef<number | null>(null);
  const pendingWidthRef = useRef<number | null>(null);

  // Stable callbacks
  const stableOnWidthChange = useEventCallback(onWidthChange);
  const stableOnDragStart = useEventCallback(onDragStart ?? (() => {}));
  const stableOnDragEnd = useEventCallback(onDragEnd ?? (() => {}));
  const stableOnDraggingChange = useEventCallback(onDraggingChange ?? (() => {}));

  // Sync refs in useIsomorphicLayoutEffect - runs synchronously after render, before paint
  // SSR-safe: falls back to useEffect on server to avoid hydration warnings
  useIsomorphicLayoutEffect(() => {
    widthRef.current = width;
    minWidthRef.current = minWidth;
    maxWidthRef.current = maxWidth;
    minWidthPxRef.current = minWidthPx;
    maxWidthPxRef.current = maxWidthPx;
  }, [width, minWidth, maxWidth, minWidthPx, maxWidthPx]);

  // Keep startWidthRef in sync when not dragging (for reference only)
  useIsomorphicLayoutEffect(() => {
    if (!isDragging) {
      startWidthRef.current = width;
    }
  }, [isDragging, width]);

  // Cleanup RAF on unmount
  useEffect(() => {
    return () => {
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
      }
    };
  }, []);

  // Resize drag handler using @use-gesture/react
  const bindResizeHandle = useDrag(
    ({ active, first, last, movement: [mx] }) => {
      if (first) {
        // Note: The original SidePanel used flushSync() here to force a synchronous render,
        // ensuring transition-none was applied before any width changes. In React 19, automatic
        // batching ensures both isDragging state and the first width update are committed in the
        // same render, making flushSync unnecessary. The transition-none class will be applied
        // before any width style change is painted.
        startDragging();
        stableOnDraggingChange(true);
        // Capture current width at drag start
        startWidthRef.current = widthRef.current;
        // Cache container width to avoid layout reflows during drag
        const container = containerRef?.current;
        containerWidthRef.current = container?.offsetWidth ?? window.innerWidth;
        // Notify snap zone integration
        stableOnDragStart(widthRef.current);
      }

      if (active) {
        const containerWidth = containerWidthRef.current;
        if (containerWidth === 0) return; // Safety check

        // Calculate new width from movement
        // Movement is negative when dragging left (making panel wider)
        const deltaPct = (-mx / containerWidth) * 100;
        const rawWidth = startWidthRef.current + deltaPct;

        // Apply percentage constraints
        let clampedWidth = Math.min(maxWidthRef.current, Math.max(minWidthRef.current, rawWidth));

        // Apply pixel constraint (prevent too-narrow panels)
        const minWidthPctFromPx = (minWidthPxRef.current / containerWidth) * 100;
        clampedWidth = Math.max(clampedWidth, minWidthPctFromPx);

        // Re-apply percentage maximum (pixel minimum shouldn't override this)
        clampedWidth = Math.min(clampedWidth, maxWidthRef.current);

        // Ensure we never exceed available container space (handles viewport < minWidthPx edge case)
        clampedWidth = Math.min(clampedWidth, 100);

        // Apply pixel constraint (prevent too-wide panels)
        if (maxWidthPxRef.current > 0) {
          const maxWidthPctFromPx = (maxWidthPxRef.current / containerWidth) * 100;
          clampedWidth = Math.min(clampedWidth, maxWidthPctFromPx);
        }

        // Only update if there's an actual change (avoids redundant updates on click)
        // Use threshold to handle floating point precision
        if (Math.abs(clampedWidth - widthRef.current) > 0.01) {
          if (batchWithRAF) {
            // RAF-batched mode: update once per frame with pixel rounding
            // Round to whole pixels for visual stability (prevents sub-pixel jitter)
            const pixelWidth = Math.round((clampedWidth / 100) * containerWidth);
            const roundedWidth = (pixelWidth / containerWidth) * 100;
            pendingWidthRef.current = roundedWidth;
            if (rafIdRef.current === null) {
              rafIdRef.current = requestAnimationFrame(() => {
                rafIdRef.current = null;
                if (pendingWidthRef.current !== null) {
                  stableOnWidthChange(pendingWidthRef.current);
                  pendingWidthRef.current = null;
                }
              });
            }
          } else {
            // Direct mode: update immediately
            stableOnWidthChange(clampedWidth);
          }
        }
      }

      if (last) {
        stopDragging();
        stableOnDraggingChange(false);
        stableOnDragEnd();
        // Flush any pending RAF update
        if (rafIdRef.current !== null) {
          cancelAnimationFrame(rafIdRef.current);
          rafIdRef.current = null;
          if (pendingWidthRef.current !== null) {
            stableOnWidthChange(Math.round(pendingWidthRef.current * 100) / 100);
            pendingWidthRef.current = null;
          }
        }

        // Restore focus to the panel after drag ends.
        // During drag, the browser moves focus to document.body (pointer events are
        // captured at the document level by @use-gesture/react). Without restoring focus,
        // usePanelEscape's focus-scoped check (panelRef.contains(document.activeElement))
        // will fail, making Escape unable to close the panel after a resize.
        const panel = panelRef?.current;
        if (panel && !panel.contains(document.activeElement)) {
          // Try to find a focusable element within the panel (skip the resize handle itself)
          const focusable = panel.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
          if (focusable) {
            focusable.focus();
          } else {
            // Fallback: focus the panel container itself.
            // This works because the panel has role="complementary" which is focusable
            // with tabindex, or we can temporarily make it focusable.
            if (!panel.hasAttribute("tabindex")) {
              panel.setAttribute("tabindex", "-1");
              panel.focus();
              // Remove tabindex after focus so it doesn't appear in tab order
              panel.removeAttribute("tabindex");
            } else {
              panel.focus();
            }
          }
        }
      }
    },
    {
      pointer: { touch: true },
    },
  );

  // Prevent text selection during drag
  useEffect(() => {
    if (isDragging) {
      document.body.style.userSelect = "none";
      document.body.style.cursor = "ew-resize";
    } else {
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    }
  }, [isDragging]);

  // Drag styles (willChange optimization) - memoized to prevent unnecessary re-renders
  const dragStyles: CSSProperties = useMemo(
    () => ({
      willChange: isDragging ? "width" : "auto",
    }),
    [isDragging],
  );

  return {
    isDragging,
    bindResizeHandle,
    dragStyles,
  };
}
