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

"use client";

import { useRef, useMemo, useEffect, useCallback, type RefObject } from "react";
import { flushSync } from "react-dom";
import { useBoolean } from "usehooks-ts";
import { useDrag } from "@use-gesture/react";
import { useHotkeys } from "react-hotkeys-hook";
import { ChevronLeft } from "lucide-react";
import { cn, isInteractiveTarget } from "@/lib/utils";
import { useIsomorphicLayoutEffect, usePrevious } from "@react-hookz/web";
import { useEventCallback } from "usehooks-ts";
import { ResizeHandle } from "./resize-handle";
import { PANEL } from "./panel-header-controls";

export interface SidePanelProps {
  width: number;
  onWidthChange: (width: number) => void;
  minWidth?: number;
  maxWidth?: number;
  minWidthPx?: number;
  children: React.ReactNode;
  "aria-label"?: string;
  className?: string;
  edgeContent?: React.ReactNode;
  edgeWidth?: number | string;
  isCollapsed?: boolean;
  onToggleCollapsed?: () => void;
  collapsedContent?: React.ReactNode;
  collapsedWidth?: number | string;
  onEscapeKey?: () => void;
  toggleHotkey?: string;
  containerRef?: RefObject<HTMLDivElement | null>;
  onDraggingChange?: (isDragging: boolean) => void;
  focusTargetRef?: React.MutableRefObject<HTMLElement | null | undefined>;
  /** Called when drag starts (for snap zone integration). Receives initial width percentage. */
  onDragStart?: (initialPct?: number) => void;
  /** Called when drag ends (for snap zone integration) */
  onDragEnd?: () => void;
  /**
   * When true, panel fills its container (for use inside CSS Grid where parent controls sizing).
   * The panel will NOT set its own width percentage - the grid template handles that.
   * Only minWidthPx constraint is applied when not collapsed.
   */
  fillContainer?: boolean;
}

export function SidePanel({
  width,
  onWidthChange,
  minWidth = PANEL.MIN_WIDTH_PCT,
  maxWidth = PANEL.MAX_WIDTH_PCT,
  minWidthPx = 320,
  children,
  "aria-label": ariaLabel,
  className,
  // Edge content (always visible)
  edgeContent,
  edgeWidth = PANEL.COLLAPSED_WIDTH_PX,
  // Collapsible mode
  isCollapsed = false,
  onToggleCollapsed,
  collapsedContent,
  collapsedWidth = PANEL.COLLAPSED_WIDTH_PX,
  // Escape key handling
  onEscapeKey,
  // Toggle hotkey
  toggleHotkey,
  containerRef: externalContainerRef,
  onDraggingChange,
  focusTargetRef,
  // Snap zone integration
  onDragStart,
  onDragEnd,
  // Grid container mode
  fillContainer = false,
}: SidePanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  // Drag state for resize handle
  const { value: isDragging, setTrue: startDragging, setFalse: stopDragging } = useBoolean(false);
  // Store the width at drag start to calculate absolute new width from movement
  const startWidthRef = useRef(width);
  // Cache container width at drag start to avoid layout reflows during drag
  const containerWidthRef = useRef(0);

  // RAF batching refs for drag updates
  const pendingRafRef = useRef<number | null>(null);
  const pendingWidthRef = useRef<number | null>(null);

  // Refs that MUST be updated synchronously during render (not in effects!)
  const widthRef = useRef(width);
  const minWidthRef = useRef(minWidth);
  const maxWidthRef = useRef(maxWidth);
  const minWidthPxRef = useRef(minWidthPx);

  // Sync refs in useIsomorphicLayoutEffect
  useIsomorphicLayoutEffect(() => {
    widthRef.current = width;
    minWidthRef.current = minWidth;
    maxWidthRef.current = maxWidth;
    minWidthPxRef.current = minWidthPx;
  }, [width, minWidth, maxWidth, minWidthPx]);

  // Keep startWidthRef in sync when not dragging
  useIsomorphicLayoutEffect(() => {
    if (!isDragging) {
      startWidthRef.current = width;
    }
  }, [isDragging, width]);

  // Stable callbacks - useEventCallback ensures stable reference with latest closure values
  const stableOnWidthChange = useEventCallback(onWidthChange);
  const stableOnEscapeKey = useEventCallback(onEscapeKey ?? (() => {}));
  const stableOnDragStart = useEventCallback((pct?: number) => onDragStart?.(pct));
  const stableOnDragEnd = useEventCallback(() => onDragEnd?.());

  // Global escape key handler using react-hotkeys-hook
  // Automatically handles: enabled state, form element detection
  useHotkeys(
    "escape",
    (e) => {
      // Skip if target is in a dropdown or interactive element
      if (isInteractiveTarget(e.target)) return;
      stableOnEscapeKey();
    },
    {
      enabled: !!onEscapeKey && !isCollapsed,
      enableOnFormTags: false, // Don't trigger when focused on input/textarea/select
    },
    [stableOnEscapeKey],
  );

  // Stable callback for toggle
  const stableOnToggleCollapsed = useEventCallback(onToggleCollapsed ?? (() => {}));

  // Global toggle hotkey handler using react-hotkeys-hook
  // Allows quick expand/collapse via keyboard shortcut (e.g., Cmd+] or Ctrl+])
  useHotkeys(
    toggleHotkey ?? "",
    (e) => {
      // Skip if target is in a dropdown or interactive element
      if (isInteractiveTarget(e.target)) return;
      e.preventDefault();
      stableOnToggleCollapsed();
    },
    {
      enabled: !!toggleHotkey && !!onToggleCollapsed,
      enableOnFormTags: false,
    },
    [stableOnToggleCollapsed],
  );

  // Resize drag handler
  const bindResizeHandle = useDrag(
    ({ active, first, last, movement: [mx] }) => {
      if (first) {
        // Capture initial width for delta calculation
        startWidthRef.current = widthRef.current;

        // Get container width from parent element BEFORE any state updates
        const container = externalContainerRef?.current ?? panelRef.current?.parentElement;
        containerWidthRef.current = container?.offsetWidth ?? window.innerWidth;

        // Force synchronous re-render to apply transition-none BEFORE width changes
        // This prevents the CSS transition from briefly animating the width change
        flushSync(() => {
          startDragging();
          stableOnDragStart(widthRef.current);
        });
      }

      if (active) {
        const containerWidth = containerWidthRef.current;
        if (containerWidth === 0) return;

        // Movement is negative when dragging left (making panel wider)
        const deltaPct = (-mx / containerWidth) * 100;

        const rawWidth = startWidthRef.current + deltaPct;

        // Calculate effective minimum: max of percentage-based min and pixel-based min
        let effectiveMin = minWidthRef.current;
        if (minWidthPxRef.current && containerWidth > 0) {
          const minPctFromPx = (minWidthPxRef.current / containerWidth) * 100;
          effectiveMin = Math.max(effectiveMin, minPctFromPx);
        }

        const clampedWidth = Math.min(maxWidthRef.current, Math.max(effectiveMin, rawWidth));

        // Calculate pixel width and round to whole pixels for stability
        const pixelWidth = Math.round((clampedWidth / 100) * containerWidth);
        // Convert back to percentage based on rounded pixel value
        const roundedWidth = (pixelWidth / containerWidth) * 100;

        if (Math.abs(roundedWidth - widthRef.current) > 0.01) {
          // Batch width updates to animation frame for 60fps performance
          pendingWidthRef.current = roundedWidth;

          if (pendingRafRef.current === null) {
            pendingRafRef.current = requestAnimationFrame(() => {
              pendingRafRef.current = null;
              const width = pendingWidthRef.current;
              pendingWidthRef.current = null;

              if (width !== null) {
                stableOnWidthChange(width);
              }
            });
          }
        }
      }

      if (last) {
        stopDragging();
        stableOnDragEnd(); // Notify snap zone system
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

  // Cleanup pending RAF on unmount or when drag ends
  useEffect(() => {
    return () => {
      if (pendingRafRef.current !== null) {
        cancelAnimationFrame(pendingRafRef.current);
        pendingRafRef.current = null;
        pendingWidthRef.current = null;
      }
    };
  }, []);

  // Cancel pending RAF when drag ends
  useEffect(() => {
    if (!isDragging && pendingRafRef.current !== null) {
      cancelAnimationFrame(pendingRafRef.current);
      pendingRafRef.current = null;
      pendingWidthRef.current = null;
    }
  }, [isDragging]);

  // Notify parent of drag state changes (for coordinating with viewport centering)
  useEffect(() => {
    onDraggingChange?.(isDragging);
  }, [isDragging, onDraggingChange]);

  // Refs for focus management
  const panelContentRef = useRef<HTMLDivElement>(null);
  const collapsedContentRef = useRef<HTMLDivElement>(null);

  // Track collapsed state to detect transitions
  const prevCollapsed = usePrevious(isCollapsed);

  // Pending focus targets (set when transition starts, cleared when it ends)
  const pendingFocusRef = useRef<"collapsed" | "expanded" | null>(null);

  // Mark pending focus when collapse state changes
  useEffect(() => {
    const justExpanded = prevCollapsed === true && isCollapsed === false;
    const justCollapsed = prevCollapsed === false && isCollapsed === true;

    if (justExpanded) {
      pendingFocusRef.current = "expanded";
    } else if (justCollapsed) {
      pendingFocusRef.current = "collapsed";
    }
  }, [isCollapsed, prevCollapsed]);

  // Focus selector for finding focusable elements
  const focusableSelector = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

  // Handle transition end on collapsed content wrapper
  const handleCollapsedTransitionEnd = useCallback(
    (e: React.TransitionEvent) => {
      // Only handle opacity transitions on this container (not bubbled from children)
      if (e.propertyName !== "opacity" || e.target !== collapsedContentRef.current) return;

      // Focus first element in collapsed strip when collapsing completes
      if (pendingFocusRef.current === "collapsed" && collapsedContentRef.current) {
        pendingFocusRef.current = null;
        const firstFocusable = collapsedContentRef.current.querySelector<HTMLElement>(focusableSelector);
        firstFocusable?.focus();
      }
    },
    [focusableSelector],
  );

  // Handle transition end on panel content wrapper
  const handlePanelTransitionEnd = useCallback(
    (e: React.TransitionEvent) => {
      // Only handle opacity transitions on this container (not bubbled from children)
      if (e.propertyName !== "opacity" || e.target !== panelContentRef.current) return;

      // Focus when expanding completes
      if (pendingFocusRef.current === "expanded" && panelContentRef.current) {
        pendingFocusRef.current = null;

        // Check if focus target ref has an override value (not undefined)
        if (focusTargetRef && focusTargetRef.current !== undefined) {
          const target = focusTargetRef.current;
          // Reset to undefined so future expands use default behavior
          focusTargetRef.current = undefined;
          // If an element was provided, focus it; if null, skip focus entirely
          target?.focus();
          return;
        }

        // Default behavior: focus first focusable element in panel
        const firstFocusable = panelContentRef.current.querySelector<HTMLElement>(focusableSelector);
        firstFocusable?.focus();
      }
    },
    [focusableSelector, focusTargetRef],
  );

  // Calculate panel width based on collapsed state and container mode
  const getPanelWidth = (): string => {
    // IMPORTANT: Check fillContainer FIRST!
    // In fillContainer mode (CSS Grid), panel ALWAYS fills its grid cell (100%),
    // regardless of collapsed state. The grid template controls actual sizing.
    if (fillContainer) {
      return "100%";
    }
    // In standalone mode, panel controls its own width
    if (isCollapsed) {
      return typeof collapsedWidth === "number" ? `${collapsedWidth}px` : collapsedWidth;
    }
    return `${width}%`;
  };
  const panelWidth = getPanelWidth();

  // Default collapsed content
  const defaultCollapsedContent = useMemo(
    () =>
      onToggleCollapsed ? (
        <button
          onClick={onToggleCollapsed}
          className="flex h-full w-full items-center justify-center text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
          aria-label="Expand panel"
        >
          <ChevronLeft className="size-5" />
        </button>
      ) : null,
    [onToggleCollapsed],
  );

  const effectiveCollapsedContent = collapsedContent ?? defaultCollapsedContent;

  // Calculate edge width value for CSS
  const edgeWidthPx = typeof edgeWidth === "number" ? `${edgeWidth}px` : edgeWidth;

  return (
    <aside
      ref={panelRef}
      className={cn(
        // Note: NO overflow-hidden on the aside - it clips the resize handle which extends
        // 8px outside via -translate-x-1/2. The inner content wrappers have overflow-hidden.
        "relative z-10 flex h-full shrink-0 border-l border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-900",
        // Disable transitions during drag for smooth 60fps resizing
        // In fillContainer mode, grid handles width transitions via grid-template-columns
        isDragging || fillContainer ? "transition-none" : "transition-[width] duration-200 ease-out",
        // Note: We use "layout style" instead of "layout style paint" because
        // contain: paint clips content at the boundary, which would hide the
        // resize handle that extends 8px outside the panel via -translate-x-1/2.
        "contain-layout-style",
        className,
      )}
      style={{
        // In fillContainer mode: no width set, panel fills grid cell.
        // Grid's grid-template-columns controls the actual width.
        width: panelWidth,
        // Apply width constraints when not collapsed.
        // In fillContainer mode, skip ALL width constraints (grid controls sizing completely).
        maxWidth: isCollapsed || fillContainer ? undefined : `${maxWidth}%`,
        minWidth: isCollapsed || fillContainer ? undefined : `${minWidthPx}px`,
        // Force GPU layer during drag (translate3d creates composite layer)
        // Combined with backface-visibility: hidden, this ensures smooth compositor-based resize
        transform: isDragging ? "translate3d(0, 0, 0)" : undefined,
        backfaceVisibility: isDragging ? "hidden" : undefined,
      }}
      role="complementary"
      aria-label={ariaLabel}
    >
      {/* Resize Handle - positioned at panel's left edge (before edge strip) */}
      {/* IMPORTANT: In fillContainer mode, ALWAYS visible (grid controls sizing) */}
      {/* In standalone mode, only visible when not collapsed */}
      {(fillContainer || !isCollapsed) && (
        <ResizeHandle
          bindResizeHandle={bindResizeHandle}
          isDragging={isDragging}
          className="absolute top-0 left-0 z-20 h-full -translate-x-1/2"
          aria-valuenow={width}
          aria-valuemin={minWidth}
          aria-valuemax={maxWidth}
        />
      )}

      {/* Edge content - always visible on left side */}
      {edgeContent && (
        <div
          className={cn(
            "flex h-full shrink-0 flex-col border-r border-zinc-200 dark:border-zinc-700",
            // Isolate edge content from layout changes during resize
            "contain-layout-style",
          )}
          style={{ width: edgeWidthPx }}
        >
          {edgeContent}
        </div>
      )}

      {/* Main content area */}
      <div
        className={cn(
          "relative flex min-w-0 flex-1 flex-col overflow-hidden overscroll-contain",
          // Use stricter containment during drag to prevent layout recalculations
          // from propagating through the tree and causing jitter
          isDragging ? "contain-strict" : "contain-layout-style",
        )}
      >
        {/* Collapsed content */}
        {/* Use inert to fully disable keyboard navigation and close tooltips when expanded */}
        {/* IMPORTANT: In fillContainer mode (grid), don't show collapsed content - grid controls sizing */}
        {effectiveCollapsedContent && !fillContainer && (
          <div
            ref={collapsedContentRef}
            className={cn(
              "absolute inset-0 overflow-hidden transition-opacity duration-200 ease-out",
              isCollapsed ? "opacity-100" : "pointer-events-none opacity-0",
            )}
            // inert removes from tab order and accessibility tree when panel is expanded
            inert={!isCollapsed ? true : undefined}
            onTransitionEnd={handleCollapsedTransitionEnd}
          >
            {effectiveCollapsedContent}
          </div>
        )}

        {/* Panel content */}
        {/* Use inert to fully disable keyboard navigation when panel is collapsed */}
        {/* IMPORTANT: In fillContainer mode (grid), content always visible - grid controls sizing */}
        <div
          ref={panelContentRef}
          className={cn(
            "flex h-full w-full min-w-0 flex-col overflow-hidden transition-opacity duration-200 ease-out",
            // In fillContainer mode, keep content visible (grid handles sizing)
            // In standalone mode, fade out when collapsed
            fillContainer ? "opacity-100" : isCollapsed ? "pointer-events-none opacity-0" : "opacity-100",
            // Disable pointer events during drag to prevent hover states causing reflow
            isDragging && "pointer-events-none",
            // Use stricter containment during drag to isolate size calculations
            // This prevents content reflow from causing scrollbar jitter
            isDragging ? "contain-strict" : "contain-layout-style",
          )}
          // inert removes from tab order and accessibility tree when panel is collapsed
          // But NOT in fillContainer mode where content should remain accessible
          inert={isCollapsed && !fillContainer ? true : undefined}
          onTransitionEnd={handlePanelTransitionEnd}
        >
          {children}
        </div>
      </div>
    </aside>
  );
}
