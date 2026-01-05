// Copyright (c) 2026, NVIDIA CORPORATION. All rights reserved.
//
// NVIDIA CORPORATION and its licensors retain all intellectual property
// and proprietary rights in and to this software, related documentation
// and any modifications thereto. Any use, reproduction, disclosure or
// distribution of this software and related documentation without an express
// license agreement from NVIDIA CORPORATION is strictly prohibited.

"use client";

import { useCallback, useEffect, useRef, useState, useMemo } from "react";
import { GripVertical } from "lucide-react";
import { cn } from "@/lib/utils";
import { getShellHeaderHeight } from "@/lib/css-utils";

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

  // Read shell header height from CSS variables (static, read once per mount)
  const headerHeight = useMemo(() => getShellHeaderHeight(), []);

  // Drag state for resize handle
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef<{ x: number; startWidth: number; containerWidth: number } | null>(null);

  // Handle keyboard events on panel
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        // Only close if no dropdown/popover is open
        const target = e.target as HTMLElement;
        const isInDropdown = target.closest("[data-radix-popper-content-wrapper]");
        if (!isInDropdown) {
          onClose();
        }
      }
    },
    [onClose]
  );

  // Global escape key handler when panel is open
  useEffect(() => {
    if (!open) return;

    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        const isInDropdown = (e.target as HTMLElement)?.closest(
          "[data-radix-popper-content-wrapper]"
        );
        if (!isInDropdown) {
          onClose();
        }
      }
    };

    document.addEventListener("keydown", handleGlobalKeyDown);
    return () => document.removeEventListener("keydown", handleGlobalKeyDown);
  }, [open, onClose]);

  // Resize drag handlers
  const handleResizeMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      setIsDragging(true);
      // Use the container width for percentage calculations (content column width)
      const containerWidth = containerRef.current?.offsetWidth ?? window.innerWidth;
      dragStartRef.current = { x: e.clientX, startWidth: width, containerWidth };
    },
    [width]
  );

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!dragStartRef.current) return;

      const { containerWidth } = dragStartRef.current;
      const deltaX = dragStartRef.current.x - e.clientX;
      const deltaPct = (deltaX / containerWidth) * 100;
      const newWidth = Math.min(
        maxWidth,
        Math.max(minWidth, dragStartRef.current.startWidth + deltaPct)
      );
      onWidthChange(newWidth);
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
  }, [isDragging, onWidthChange, minWidth, maxWidth]);

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
    <div ref={containerRef} className="relative h-full w-full">
      {/* Main content - always full width */}
      <div className="h-full w-full">{mainContent}</div>

      {/* Backdrop - fixed to cover content area only (below header, right of sidebar) */}
      {/* Note: Shell uses contain:layout, so fixed is relative to content column, not viewport */}
      {open && (
        <div
          className="fixed inset-0 z-40 bg-white/25 backdrop-blur-[2px] backdrop-saturate-50 transition-opacity duration-200 dark:bg-black/50"
          style={{ top: headerHeight }}
          onClick={() => {
            // Don't close if we're in the middle of a resize drag
            if (!isDragging) {
              onClose();
            }
          }}
          aria-hidden="true"
        />
      )}

      {/* Overlay panel - fixed to content area */}
      {/* Note: Shell uses contain:layout, so fixed is relative to content column */}
      <aside
        ref={panelRef}
        className={cn(
          "fixed bottom-0 right-0 z-50 flex flex-col border-l border-zinc-200 bg-white/95 shadow-2xl backdrop-blur transition-transform duration-200 ease-out dark:border-zinc-700 dark:bg-zinc-900/95",
          open ? "translate-x-0" : "translate-x-full",
          className
        )}
        style={{
          top: headerHeight,
          width: `${width}%`,
          maxWidth: `${maxWidth}%`,
          minWidth: `${minWidthPx}px`,
          contain: "layout style",
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
              : "before:bg-transparent hover:before:bg-zinc-300 dark:hover:before:bg-zinc-600"
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
              "absolute left-1/2 top-1/2 z-[70] -translate-x-1/2 -translate-y-1/2 rounded-sm bg-zinc-100 px-px py-1 shadow-md transition-opacity duration-150 dark:bg-zinc-800",
              isDragging ? "opacity-100" : "opacity-0 group-hover:opacity-100"
            )}
            aria-hidden="true"
          >
            <GripVertical className="size-3 text-zinc-400 dark:text-zinc-500" strokeWidth={1.5} />
          </div>
        </div>

        {/* Panel content - overflow hidden here */}
        {open && (
          <div className="flex h-full flex-col overflow-hidden">
            {children}
          </div>
        )}
      </aside>
    </div>
  );
}
