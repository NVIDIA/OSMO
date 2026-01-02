/**
 * Copyright (c) 2026, NVIDIA CORPORATION. All rights reserved.
 *
 * NVIDIA CORPORATION and its licensors retain all intellectual property
 * and proprietary rights in and to this software, related documentation
 * and any modifications thereto. Any use, reproduction, disclosure or
 * distribution of this software and related documentation without an express
 * license agreement from NVIDIA CORPORATION is strictly prohibited.
 */

/**
 * ResourcePanelLayout Component
 *
 * Overlay panel for resource details with:
 * - Resizable width via drag handle
 * - Width snap presets
 * - Keyboard navigation (Escape to close)
 * - Screen reader accessibility
 * - Click-outside to close
 *
 * Based on PoolPanelLayout architecture.
 */

"use client";

import { useCallback, useEffect, useRef, useState, useMemo } from "react";
import { GripVertical } from "lucide-react";
import type { Resource } from "@/lib/api/adapter";
import { cn } from "@/lib/utils";
import { useResourcesTableStore } from "../../stores/resources-table-store";
import { getShellHeaderHeight } from "../../hooks";
import { PANEL } from "../../lib";
import { ResourcePanelHeader } from "./panel-header";
import { ResourcePanelContent } from "./panel-content";

export interface ResourcePanelLayoutProps {
  resource: Resource | null;
  onClose: () => void;
  /** Currently selected pool for config tab (URL-synced) */
  selectedPool?: string | null;
  /** Callback when pool tab is selected */
  onPoolSelect?: (pool: string | null) => void;
  children: React.ReactNode;
}

export function ResourcePanelLayout({
  resource,
  onClose,
  selectedPool,
  onPoolSelect,
  children,
}: ResourcePanelLayoutProps) {
  const panelWidth = useResourcesTableStore((s) => s.panelWidth);
  const setPanelWidth = useResourcesTableStore((s) => s.setPanelWidth);
  const panelRef = useRef<HTMLDivElement>(null);

  // Read shell header height from CSS variables
  const headerHeight = useMemo(() => getShellHeaderHeight(), []);

  // Drag state for resize handle
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef<{ x: number; startWidth: number; containerWidth: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleWidthPreset = useCallback((pct: number) => setPanelWidth(pct), [setPanelWidth]);

  // Handle keyboard events
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
    [onClose],
  );

  // Global escape key handler when panel is open
  useEffect(() => {
    if (!resource) return;

    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        const isInDropdown = (e.target as HTMLElement)?.closest(
          "[data-radix-popper-content-wrapper]",
        );
        if (!isInDropdown) {
          onClose();
        }
      }
    };

    document.addEventListener("keydown", handleGlobalKeyDown);
    return () => document.removeEventListener("keydown", handleGlobalKeyDown);
  }, [resource, onClose]);

  // Resize drag handlers
  const handleResizeMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      setIsDragging(true);
      const containerWidth = containerRef.current?.offsetWidth ?? window.innerWidth;
      dragStartRef.current = { x: e.clientX, startWidth: panelWidth, containerWidth };
    },
    [panelWidth],
  );

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!dragStartRef.current) return;

      const { containerWidth } = dragStartRef.current;
      const deltaX = dragStartRef.current.x - e.clientX;
      const deltaPct = (deltaX / containerWidth) * 100;
      const newWidth = Math.min(
        PANEL.MAX_WIDTH_PCT,
        Math.max(PANEL.MIN_WIDTH_PCT, dragStartRef.current.startWidth + deltaPct),
      );
      setPanelWidth(newWidth);
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
  }, [isDragging, setPanelWidth]);

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
      <div className="h-full w-full">{children}</div>

      {/* Backdrop */}
      {resource && (
        <div
          className="fixed inset-0 z-40 bg-white/25 backdrop-blur-[2px] backdrop-saturate-50 transition-opacity duration-200 dark:bg-black/50"
          style={{ top: headerHeight }}
          onClick={() => {
            if (!isDragging) {
              onClose();
            }
          }}
          aria-hidden="true"
        />
      )}

      {/* Overlay panel */}
      <aside
        ref={panelRef}
        className={cn(
          "fixed bottom-0 right-0 z-50 flex flex-col overflow-hidden border-l border-zinc-200 bg-white/95 shadow-2xl backdrop-blur transition-transform duration-200 ease-out dark:border-zinc-700 dark:bg-zinc-900/95",
          resource ? "translate-x-0" : "translate-x-full",
        )}
        style={{
          top: headerHeight,
          width: `${panelWidth}%`,
          maxWidth: `${PANEL.MAX_WIDTH_PCT}%`,
          minWidth: "320px",
        }}
        role="complementary"
        aria-label={resource ? `Resource details: ${resource.name}` : undefined}
        aria-hidden={!resource}
        onKeyDown={handleKeyDown}
      >
        {/* Resize Handle */}
        <div
          className={cn(
            "group absolute inset-y-0 left-0 z-20 w-2 -translate-x-1/2 cursor-ew-resize",
            isDragging ? "bg-blue-500" : "bg-transparent hover:bg-zinc-400 dark:hover:bg-zinc-600",
          )}
          onMouseDown={handleResizeMouseDown}
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize panel"
          aria-valuenow={panelWidth}
          aria-valuemin={PANEL.MIN_WIDTH_PCT}
          aria-valuemax={PANEL.MAX_WIDTH_PCT}
        >
          <div
            className={cn(
              "absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded bg-zinc-300 px-0.5 py-1 shadow-md transition-opacity duration-150 dark:bg-zinc-700",
              isDragging ? "opacity-100" : "opacity-0 group-hover:opacity-100",
            )}
            aria-hidden="true"
          >
            <GripVertical className="size-4 text-zinc-600 dark:text-zinc-300" />
          </div>
        </div>

        {resource && (
          <>
            <ResourcePanelHeader
              resource={resource}
              onClose={onClose}
              onWidthPreset={handleWidthPreset}
            />
            <ResourcePanelContent
              resource={resource}
              selectedPool={selectedPool}
              onPoolSelect={onPoolSelect}
            />
          </>
        )}
      </aside>
    </div>
  );
}
