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
  /** When true, panel spans 100% width with no resize handle */
  fullWidth?: boolean;
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
  fullWidth = false,
}: SidePanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const internalContainerRef = useRef<HTMLDivElement>(null);

  // Use external container ref if provided, otherwise use internal
  const containerRef = externalContainerRef ?? internalContainerRef;

  // Drag state for resize handle
  const { value: isDragging, setTrue: startDragging, setFalse: stopDragging } = useBoolean(false);
  // Store the width at drag start to calculate absolute new width from movement
  const startWidthRef = useRef(width);
  // Cache container width at drag start to avoid layout reflows during drag
  const containerWidthRef = useRef(0);

  // Refs that MUST be updated synchronously during render (not in effects!)
  const widthRef = useRef(width);
  const minWidthRef = useRef(minWidth);
  const maxWidthRef = useRef(maxWidth);

  // Sync refs in useIsomorphicLayoutEffect
  useIsomorphicLayoutEffect(() => {
    widthRef.current = width;
    minWidthRef.current = minWidth;
    maxWidthRef.current = maxWidth;
  }, [width, minWidth, maxWidth]);

  // Keep startWidthRef in sync when not dragging
  useIsomorphicLayoutEffect(() => {
    if (!isDragging) {
      startWidthRef.current = width;
    }
  }, [isDragging, width]);

  // Stable callbacks
  const stableOnWidthChange = useEventCallback(onWidthChange);
  const stableOnEscapeKey = useEventCallback(onEscapeKey ?? (() => {}));

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
        startDragging();
        startWidthRef.current = widthRef.current;
        // Get container width from parent element
        const container = containerRef?.current ?? panelRef.current?.parentElement;
        containerWidthRef.current = container?.offsetWidth ?? window.innerWidth;
      }

      if (active) {
        const containerWidth = containerWidthRef.current;
        if (containerWidth === 0) return;

        // Movement is negative when dragging left (making panel wider)
        const deltaPct = (-mx / containerWidth) * 100;
        const rawWidth = startWidthRef.current + deltaPct;
        const clampedWidth = Math.min(maxWidthRef.current, Math.max(minWidthRef.current, rawWidth));

        if (Math.abs(clampedWidth - widthRef.current) > 0.01) {
          stableOnWidthChange(clampedWidth);
        }
      }

      if (last) {
        stopDragging();
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

  // Calculate panel width based on fullWidth, collapsed state
  const panelWidth = fullWidth
    ? "100%"
    : isCollapsed
      ? typeof collapsedWidth === "number"
        ? `${collapsedWidth}px`
        : collapsedWidth
      : `${width}%`;

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
        "relative flex h-full shrink-0 overflow-hidden border-l border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-900",
        // Disable transitions during drag for smooth 60fps resizing
        isDragging ? "transition-none" : "transition-[width] duration-200 ease-out",
        className,
      )}
      style={{
        width: panelWidth,
        contain: "layout style paint",
        willChange: isDragging ? "width" : "auto",
        // Only apply width constraints when not fullWidth and not collapsed
        ...(isCollapsed || fullWidth
          ? {}
          : {
              maxWidth: `${maxWidth}%`,
              minWidth: `${minWidthPx}px`,
            }),
      }}
      role="complementary"
      aria-label={ariaLabel}
    >
      {/* Resize Handle - positioned at panel's left edge (before edge strip) */}
      {!isCollapsed && !fullWidth && (
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
          className="flex h-full shrink-0 flex-col border-r border-zinc-200 dark:border-zinc-700"
          style={{ width: edgeWidthPx }}
        >
          {edgeContent}
        </div>
      )}

      {/* Main content area */}
      <div className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
        {/* Collapsed content */}
        {/* Use inert to fully disable keyboard navigation and close tooltips when expanded */}
        {effectiveCollapsedContent && (
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
        <div
          ref={panelContentRef}
          className={cn(
            "flex h-full w-full min-w-0 flex-col overflow-hidden transition-opacity duration-200 ease-out",
            isCollapsed ? "pointer-events-none opacity-0" : "opacity-100",
          )}
          // inert removes from tab order and accessibility tree when panel is collapsed
          inert={isCollapsed ? true : undefined}
          onTransitionEnd={handlePanelTransitionEnd}
        >
          {children}
        </div>
      </div>
    </aside>
  );
}
