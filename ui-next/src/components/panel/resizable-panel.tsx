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

import { useCallback, useEffect, useRef, useState } from "react";
import { GripVertical } from "lucide-react";
import { cn } from "@/lib/utils";
import { useStableCallback } from "@/hooks";

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
  /** Accessible label for the panel */
  "aria-label"?: string;
  /** Additional class for the panel */
  className?: string;
}

// =============================================================================
// Component
// =============================================================================

/**
 * ResizablePanel - Generic overlay panel with drag-to-resize.
 *
 * Features:
 * - Resizable width via drag handle
 * - Backdrop with click-to-close
 * - Escape key to close (respects open dropdowns)
 * - Smooth slide-in/out animation
 * - Accessible with proper ARIA attributes
 *
 * @example
 * ```tsx
 * <ResizablePanel
 *   open={!!selectedItem}
 *   onClose={() => setSelectedItem(null)}
 *   width={panelWidth}
 *   onWidthChange={setPanelWidth}
 *   mainContent={<MainList />}
 *   aria-label={`Details for ${selectedItem?.name}`}
 * >
 *   <PanelHeader item={selectedItem} onClose={handleClose} />
 *   <PanelContent item={selectedItem} />
 * </ResizablePanel>
 * ```
 */
export function ResizablePanel({
  open,
  onClose,
  width,
  onWidthChange,
  minWidth = 20,
  maxWidth = 80,
  minWidthPx = 320,
  children,
  mainContent,
  "aria-label": ariaLabel,
  className,
}: ResizablePanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Drag state for resize handle
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef<{ x: number; startWidth: number; containerWidth: number } | null>(null);

  // Stable callbacks to prevent stale closures in effects and event handlers
  const stableOnClose = useStableCallback(onClose);
  const stableOnWidthChange = useStableCallback(onWidthChange);

  // Handle keyboard events on panel
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        // Only close if no dropdown/popover is open
        const target = e.target as HTMLElement;
        const isInDropdown = target.closest("[data-radix-popper-content-wrapper]");
        if (!isInDropdown) {
          stableOnClose();
        }
      }
    },
    [stableOnClose],
  );

  // Global escape key handler when panel is open
  useEffect(() => {
    if (!open) return;

    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        const isInDropdown = (e.target as HTMLElement)?.closest("[data-radix-popper-content-wrapper]");
        if (!isInDropdown) {
          stableOnClose();
        }
      }
    };

    document.addEventListener("keydown", handleGlobalKeyDown);
    return () => document.removeEventListener("keydown", handleGlobalKeyDown);
  }, [open, stableOnClose]);

  // Resize drag handlers
  const handleResizeMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      setIsDragging(true);
      // Use the container width for percentage calculations (content column width)
      const containerWidth = containerRef.current?.offsetWidth ?? window.innerWidth;
      dragStartRef.current = { x: e.clientX, startWidth: width, containerWidth };
    },
    [width],
  );

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!dragStartRef.current) return;

      const { containerWidth } = dragStartRef.current;
      const deltaX = dragStartRef.current.x - e.clientX;
      const deltaPct = (deltaX / containerWidth) * 100;
      const newWidth = Math.min(maxWidth, Math.max(minWidth, dragStartRef.current.startWidth + deltaPct));
      stableOnWidthChange(newWidth);
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      dragStartRef.current = null;
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isDragging, stableOnWidthChange, minWidth, maxWidth]);

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

  return (
    <div
      ref={containerRef}
      className="relative h-full w-full"
    >
      {/* Main content - always full width */}
      <div className="h-full w-full">{mainContent}</div>

      {/* Backdrop - fixed to cover content area only (below header, right of sidebar) */}
      {open && (
        <div
          className="fixed-below-header z-40 bg-white/25 backdrop-blur-[2px] backdrop-saturate-50 transition-opacity duration-200 dark:bg-black/50"
          onClick={() => {
            // Don't close if we're in the middle of a resize drag
            if (!isDragging) {
              stableOnClose();
            }
          }}
          aria-hidden="true"
        />
      )}

      {/* Overlay panel - fixed to content area */}
      <aside
        ref={panelRef}
        className={cn(
          "top-shell-header contain-layout-style fixed right-0 bottom-0 z-50 flex flex-col border-l border-zinc-200 bg-white/95 shadow-2xl backdrop-blur transition-transform duration-200 ease-out dark:border-zinc-700 dark:bg-zinc-900/95",
          open ? "translate-x-0" : "translate-x-full",
          className,
        )}
        style={{
          width: `${width}%`,
          maxWidth: `${maxWidth}%`,
          minWidth: `${minWidthPx}px`,
        }}
        role="complementary"
        aria-label={ariaLabel}
        aria-hidden={!open}
        onKeyDown={handleKeyDown}
      >
        {/* Resize Handle - wide hit area, thin visible border */}
        <div
          className={cn(
            "group absolute inset-y-0 left-0 z-[60] w-4 -translate-x-1/2 cursor-ew-resize",
            // Thin 2px border in the center of the hit area
            "before:absolute before:inset-y-0 before:left-1/2 before:w-0.5 before:-translate-x-1/2 before:transition-colors",
            isDragging
              ? "before:bg-blue-500"
              : "before:bg-transparent hover:before:bg-zinc-300 dark:hover:before:bg-zinc-600",
          )}
          onMouseDown={handleResizeMouseDown}
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize panel"
          aria-valuenow={width}
          aria-valuemin={minWidth}
          aria-valuemax={maxWidth}
        >
          <div
            className={cn(
              "absolute top-1/2 left-1/2 z-[70] -translate-x-1/2 -translate-y-1/2 rounded-sm bg-zinc-100 px-px py-1 shadow-md transition-opacity duration-150 dark:bg-zinc-800",
              isDragging ? "opacity-100" : "opacity-0 group-hover:opacity-100",
            )}
            aria-hidden="true"
          >
            <GripVertical
              className="size-3 text-zinc-400 dark:text-zinc-500"
              strokeWidth={1.5}
            />
          </div>
        </div>

        {/* Panel content - overflow hidden here */}
        {open && <div className="flex h-full flex-col overflow-hidden">{children}</div>}
      </aside>
    </div>
  );
}
