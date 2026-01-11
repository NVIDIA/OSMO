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
 * SidePanel Component
 *
 * A simplified side panel for master/detail layouts.
 * Unlike ResizablePanel (overlay model), SidePanel is designed to be used
 * as a sibling to the main content in a flexbox layout.
 *
 * Features:
 * - Resizable width via drag handle (percentage of container)
 * - Collapsible to edge strip
 * - Escape key handling
 * - Smooth transitions
 * - Accessible with proper ARIA attributes
 *
 * The panel is a flex child, not an overlay. The parent container should use
 * flexbox layout, and the sibling (main content) will naturally resize.
 *
 * @example
 * ```tsx
 * <div className="flex h-full">
 *   <div className="min-w-0 flex-1">{mainContent}</div>
 *   <SidePanel
 *     width={panelPct}
 *     onWidthChange={setPanelPct}
 *     isCollapsed={isCollapsed}
 *     onToggleCollapsed={toggleCollapsed}
 *   >
 *     <PanelContent />
 *   </SidePanel>
 * </div>
 * ```
 */

"use client";

import { useEffect, useRef, useState, useMemo, type RefObject } from "react";
import { useDrag } from "@use-gesture/react";
import { ChevronLeft } from "lucide-react";
import { cn } from "@/lib/utils";
import { useIsomorphicLayoutEffect } from "@react-hookz/web";
import { useStableCallback } from "@/hooks";
import { ResizeHandle } from "./resize-handle";
import { PANEL } from "./panel-header-controls";

// =============================================================================
// Types
// =============================================================================

export interface SidePanelProps {
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
  /** Accessible label for the panel */
  "aria-label"?: string;
  /** Additional class for the panel */
  className?: string;

  // Collapsible mode
  /** Whether the panel is currently collapsed (controlled) */
  isCollapsed?: boolean;
  /** Callback to toggle collapsed state */
  onToggleCollapsed?: () => void;
  /** Content to render when collapsed (slot for domain-specific content) */
  collapsedContent?: React.ReactNode;
  /** Width when collapsed (default: 40px) */
  collapsedWidth?: number | string;

  // Escape key handling
  /** Custom escape key handler */
  onEscapeKey?: () => void;

  /** Ref to the parent container (for resize calculations) */
  containerRef?: RefObject<HTMLDivElement | null>;
}

// =============================================================================
// Component
// =============================================================================

export function SidePanel({
  width,
  onWidthChange,
  minWidth = PANEL.MIN_WIDTH_PCT,
  maxWidth = PANEL.MAX_WIDTH_PCT,
  minWidthPx = 320,
  children,
  "aria-label": ariaLabel,
  className,
  // Collapsible mode
  isCollapsed = false,
  onToggleCollapsed,
  collapsedContent,
  collapsedWidth = PANEL.COLLAPSED_WIDTH_PX,
  // Escape key handling
  onEscapeKey,
  containerRef: externalContainerRef,
}: SidePanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const internalContainerRef = useRef<HTMLDivElement>(null);

  // Use external container ref if provided, otherwise use internal
  const containerRef = externalContainerRef ?? internalContainerRef;

  // Drag state for resize handle
  const [isDragging, setIsDragging] = useState(false);
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
  const stableOnWidthChange = useStableCallback(onWidthChange);
  const stableOnEscapeKey = useStableCallback(onEscapeKey ?? (() => {}));

  // Handle keyboard events - escape key
  const handleKeyDown = useStableCallback((e: React.KeyboardEvent) => {
    if (e.key === "Escape" && onEscapeKey) {
      const target = e.target as HTMLElement;
      const isInDropdown = target.closest("[data-radix-popper-content-wrapper]");
      if (!isInDropdown) {
        stableOnEscapeKey();
      }
    }
  });

  // Global escape key handler
  useEffect(() => {
    if (!onEscapeKey) return;

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
  }, [onEscapeKey, stableOnEscapeKey]);

  // Resize drag handler
  const bindResizeHandle = useDrag(
    ({ active, first, last, movement: [mx] }) => {
      if (first) {
        setIsDragging(true);
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
        setIsDragging(false);
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

  // Calculate panel width based on collapsed state
  const panelWidth = isCollapsed
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

  return (
    <aside
      ref={panelRef}
      className={cn(
        "relative flex shrink-0 flex-col border-l border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-900",
        // Disable transitions during drag for smooth 60fps resizing
        isDragging ? "transition-none" : "transition-[width] duration-200 ease-out",
        className,
      )}
      style={{
        width: panelWidth,
        willChange: isDragging ? "width" : "auto",
        ...(isCollapsed
          ? {}
          : {
              maxWidth: `${maxWidth}%`,
              minWidth: `${minWidthPx}px`,
            }),
      }}
      role="complementary"
      aria-label={ariaLabel}
      onKeyDown={handleKeyDown}
    >
      {/* Resize Handle - positioned at panel's left edge */}
      {!isCollapsed && (
        <ResizeHandle
          bindResizeHandle={bindResizeHandle}
          isDragging={isDragging}
          className="absolute top-0 left-0 z-20 h-full -translate-x-1/2"
          aria-valuenow={width}
          aria-valuemin={minWidth}
          aria-valuemax={maxWidth}
        />
      )}

      {/* Collapsed content */}
      {effectiveCollapsedContent && (
        <div
          className={cn(
            "absolute inset-0 overflow-hidden transition-opacity duration-200 ease-out",
            isCollapsed ? "opacity-100" : "pointer-events-none opacity-0",
          )}
        >
          {effectiveCollapsedContent}
        </div>
      )}

      {/* Panel content */}
      <div
        className={cn(
          "flex h-full w-full flex-col overflow-hidden transition-opacity duration-200 ease-out",
          isCollapsed ? "pointer-events-none opacity-0" : "opacity-100",
        )}
      >
        {children}
      </div>
    </aside>
  );
}

