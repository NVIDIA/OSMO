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

import { useEffect, useRef, useState, useMemo } from "react";
import { useDrag } from "@use-gesture/react";
import { ChevronLeft } from "lucide-react";
import { cn } from "@/lib/utils";
import { useStableCallback, useStableValue, useRafCallback } from "@/hooks";
import { ResizeHandle } from "./resize-handle";
import { PANEL } from "./panel-header-controls";

// =============================================================================
// Types
// =============================================================================

export interface ResizablePanelProps {
  /** Whether the panel is open */
  open: boolean;
  /** Callback when panel should close (backdrop click, escape key) */
  onClose: () => void;
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
  /** Panel content */
  children: React.ReactNode;
  /** Main content to render behind the panel */
  mainContent: React.ReactNode;
  /** Whether to show a backdrop overlay (default: true) */
  backdrop?: boolean;
  /** Accessible label for the panel */
  "aria-label"?: string;
  /** Additional class for the panel */
  className?: string;

  // Collapsible mode
  /** Enable collapsible mode (panel can collapse to edge strip) */
  collapsible?: boolean;
  /** Whether the panel is currently collapsed (controlled) */
  isCollapsed?: boolean;
  /** Callback to toggle collapsed state */
  onToggleCollapsed?: () => void;
  /** Content to render when collapsed (slot for domain-specific content) */
  collapsedContent?: React.ReactNode;
  /** Width when collapsed (default: 40px) */
  collapsedWidth?: number | string;

  // Custom escape handling
  /** Custom escape key handler (overrides default close behavior for multi-layer navigation) */
  onEscapeKey?: () => void;
}

// =============================================================================
// Component
// =============================================================================

/**
 * ResizablePanel - Container-scoped overlay panel with drag-to-resize.
 *
 * Features:
 * - Resizable width via drag handle (percentage of container)
 * - Optional backdrop with click-to-close
 * - Escape key to close (respects open dropdowns)
 * - Optional collapsible mode with edge strip
 * - Custom escape key handling for multi-layer navigation
 * - Smooth slide-in/out animation
 * - Accessible with proper ARIA attributes
 *
 * The panel is positioned absolutely within its container, making it suitable
 * for embedding in any layout context (full page, split views, tabs, etc.).
 *
 * @example
 * ```tsx
 * // With backdrop (default) - good for tables/lists
 * <ResizablePanel
 *   open={!!selectedItem}
 *   onClose={() => setSelectedItem(null)}
 *   width={panelWidth}
 *   onWidthChange={setPanelWidth}
 *   mainContent={<MainList />}
 *   aria-label={`Details for ${selectedItem?.name}`}
 * >
 *   <PanelContent item={selectedItem} />
 * </ResizablePanel>
 *
 * // Collapsible mode - panel collapses to edge strip instead of closing
 * <ResizablePanel
 *   open={true}
 *   onClose={handleClose}
 *   width={panelWidth}
 *   onWidthChange={setPanelWidth}
 *   mainContent={<DAGCanvas />}
 *   backdrop={false}
 *   collapsible
 *   isCollapsed={isCollapsed}
 *   onToggleCollapsed={toggleCollapsed}
 *   collapsedContent={<CollapsedStrip onExpand={toggleCollapsed} />}
 *   onEscapeKey={handleMultiLayerEscape}
 * >
 *   <DetailsPanel />
 * </ResizablePanel>
 * ```
 */
export function ResizablePanel({
  open,
  onClose,
  width,
  onWidthChange,
  minWidth = PANEL.MIN_WIDTH_PCT,
  maxWidth = PANEL.MAX_WIDTH_PCT,
  minWidthPx = 320,
  children,
  mainContent,
  backdrop = true,
  "aria-label": ariaLabel,
  className,
  // Collapsible mode
  collapsible = false,
  isCollapsed = false,
  onToggleCollapsed,
  collapsedContent,
  collapsedWidth = PANEL.COLLAPSED_WIDTH_PX,
  // Custom escape handling
  onEscapeKey,
}: ResizablePanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Drag state for resize handle
  const [isDragging, setIsDragging] = useState(false);
  // Store the width at drag start to calculate absolute new width from movement
  const startWidthRef = useRef(width);
  // Cache container width at drag start to avoid layout reflows during drag
  const containerWidthRef = useRef(0);

  // Stable refs to avoid stale closures in useDrag (which memoizes the handler)
  const widthRef = useStableValue(width);
  const minWidthRef = useStableValue(minWidth);
  const maxWidthRef = useStableValue(maxWidth);

  // Stable callbacks to prevent stale closures in effects and event handlers
  const stableOnClose = useStableCallback(onClose);
  const stableOnWidthChange = useStableCallback(onWidthChange);
  const stableOnEscapeKey = useStableCallback(onEscapeKey ?? onClose);

  // RAF-throttled width updates for buttery smooth 60fps resizing
  // Uses throttle mode to process first value and skip intermediates
  const [scheduleWidthUpdate] = useRafCallback(stableOnWidthChange, { throttle: true });

  // Handle keyboard events on panel - using stable callback
  const handleKeyDown = useStableCallback((e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      // Only handle if no dropdown/popover is open
      const target = e.target as HTMLElement;
      const isInDropdown = target.closest("[data-radix-popper-content-wrapper]");
      if (!isInDropdown) {
        stableOnEscapeKey();
      }
    }
  });

  // Global escape key handler when panel is open
  useEffect(() => {
    if (!open) return;

    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        const isInDropdown = (e.target as HTMLElement)?.closest("[data-radix-popper-content-wrapper]");
        if (!isInDropdown) {
          stableOnEscapeKey();
        }
      }
    };

    document.addEventListener("keydown", handleGlobalKeyDown);
    return () => document.removeEventListener("keydown", handleGlobalKeyDown);
  }, [open, stableOnEscapeKey]);

  // Resize drag handler using @use-gesture/react
  // Uses refs to avoid stale closures (useDrag memoizes the handler internally)
  // Performance optimizations:
  // - Container width cached at drag start (avoids layout reflows)
  // - Width updates RAF-throttled (buttery 60fps)
  const bindResizeHandle = useDrag(
    ({ active, first, last, movement: [mx] }) => {
      if (first) {
        setIsDragging(true);
        // Capture the width at drag start from ref (current value)
        startWidthRef.current = widthRef.current;
        // Cache container width to avoid repeated offsetWidth reads (layout reflows)
        containerWidthRef.current = containerRef.current?.offsetWidth ?? window.innerWidth;
      }

      if (active) {
        // Use cached container width - no DOM read during drag
        const containerWidth = containerWidthRef.current;
        // Movement is negative when dragging left (making panel wider)
        // Use startWidth as the base, not current width
        const deltaPct = (-mx / containerWidth) * 100;
        const newWidth = Math.min(maxWidthRef.current, Math.max(minWidthRef.current, startWidthRef.current + deltaPct));
        // RAF-throttled for smooth 60fps updates
        scheduleWidthUpdate(newWidth);
      }

      if (last) {
        setIsDragging(false);
      }
    },
    {
      // Enable pointer events (handles mouse, touch, pen)
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

  // Calculate effective panel width based on collapsed state
  const effectiveCollapsed = collapsible && isCollapsed;
  const panelWidth = effectiveCollapsed
    ? typeof collapsedWidth === "number"
      ? `${collapsedWidth}px`
      : collapsedWidth
    : `${width}%`;

  // Default collapsed content - a simple expand button
  // Used when collapsible is enabled but no custom collapsedContent is provided
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

  // Use provided collapsedContent or fall back to default
  const effectiveCollapsedContent = collapsedContent ?? defaultCollapsedContent;

  return (
    <div
      ref={containerRef}
      className="relative h-full w-full overflow-hidden"
    >
      {/* Main content - always full width */}
      <div className="h-full w-full">{mainContent}</div>

      {/* Optional backdrop - absolute within container */}
      {backdrop && open && !effectiveCollapsed && (
        <div
          className="absolute inset-0 z-40 bg-white/25 backdrop-blur-[2px] backdrop-saturate-50 transition-opacity duration-200 dark:bg-black/50"
          onClick={() => {
            // Don't close if we're in the middle of a resize drag
            if (!isDragging) {
              stableOnClose();
            }
          }}
          aria-hidden="true"
        />
      )}

      {/* Resize Handle - positioned at panel edge within container (hidden when collapsed) */}
      {open && !effectiveCollapsed && (
        <ResizeHandle
          bindResizeHandle={bindResizeHandle}
          isDragging={isDragging}
          className="absolute top-0 z-[60] h-full"
          style={{ left: `${100 - width}%` }}
          aria-valuenow={width}
          aria-valuemin={minWidth}
          aria-valuemax={maxWidth}
        />
      )}

      {/* Panel - absolute within container */}
      <aside
        ref={panelRef}
        className={cn(
          "contain-layout-style absolute inset-y-0 right-0 z-50 flex flex-col overflow-hidden border-l border-zinc-200 bg-white/95 shadow-2xl backdrop-blur dark:border-zinc-700 dark:bg-zinc-900/95",
          open ? "translate-x-0" : "translate-x-full",
          // Disable ALL transitions during drag for buttery smooth 60fps resizing
          // Only enable transitions when not dragging (for open/close animations)
          isDragging ? "transition-none" : "transition-all duration-200 ease-out",
          className,
        )}
        style={{
          width: panelWidth,
          // GPU optimization: hint browser about upcoming width changes during drag
          willChange: isDragging ? "width" : "auto",
          ...(effectiveCollapsed
            ? {}
            : {
                maxWidth: `${maxWidth}%`,
                minWidth: `${minWidthPx}px`,
              }),
        }}
        role="complementary"
        aria-label={ariaLabel}
        aria-hidden={!open}
        onKeyDown={handleKeyDown}
      >
        {/* Collapsed content - visible when collapsed */}
        {collapsible && effectiveCollapsedContent && (
          <div
            className={cn(
              "absolute inset-0 transition-opacity duration-200 ease-out",
              effectiveCollapsed ? "opacity-100" : "pointer-events-none opacity-0",
            )}
          >
            {effectiveCollapsedContent}
          </div>
        )}

        {/* Panel content - visible when expanded */}
        {open && (
          <div
            className={cn(
              "flex h-full flex-col overflow-hidden transition-opacity duration-200 ease-out",
              effectiveCollapsed ? "pointer-events-none opacity-0" : "opacity-100",
            )}
          >
            {children}
          </div>
        )}
      </aside>
    </div>
  );
}
