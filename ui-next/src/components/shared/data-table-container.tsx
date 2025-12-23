/**
 * Copyright (c) 2025, NVIDIA CORPORATION. All rights reserved.
 *
 * NVIDIA CORPORATION and its licensors retain all intellectual property
 * and proprietary rights in and to this software, related documentation
 * and any modifications thereto. Any use, reproduction, disclosure or
 * distribution of this software and related documentation without an express
 * license agreement from NVIDIA CORPORATION is strictly prohibited.
 */

"use client";

import { useState, useEffect, useRef, ReactNode } from "react";
import { Filter, Pin, PinOff, Rows3, Rows4 } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface DataTableContainerProps {
  /** Filter bar content */
  filters: ReactNode;
  /** Summary cards content */
  summary?: ReactNode;
  /** Table header content */
  tableHeader: ReactNode;
  /** Table body content (virtualized) */
  tableBody: ReactNode;
  /** Total number of items (for display) */
  itemCount?: number;
  /** Number of filtered items (for display) */
  filteredCount?: number;
  /** Number of active filters */
  filterCount?: number;
  /** Minimum width for horizontal scroll */
  minWidth?: number;
  /** Enable compact mode toggle */
  compactMode?: boolean;
  /** Compact mode change handler */
  onCompactModeChange?: (compact: boolean) => void;
  /** Collapse threshold (0-1). Default: 0.5 */
  collapseThreshold?: number;
  /** Ref to the scroll container (for virtualization) */
  scrollRef?: React.RefObject<HTMLDivElement>;
  /** Header ref for horizontal scroll sync */
  headerRef?: React.RefObject<HTMLDivElement>;
  /** Additional class names for the container */
  className?: string;
}

/**
 * Container component for data tables with collapsible controls panel.
 *
 * Features:
 * - Auto-collapse when controls panel exceeds threshold of container height
 * - Manual pin/unpin to override auto behavior
 * - Smooth CSS Grid transitions for collapse/expand
 * - Horizontal scroll sync between header and body
 * - Optional compact mode toggle
 */
export function DataTableContainer({
  filters,
  summary,
  tableHeader,
  tableBody,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  itemCount: _itemCount,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  filteredCount: _filteredCount,
  filterCount = 0,
  minWidth = 820,
  compactMode = false,
  onCompactModeChange,
  collapseThreshold = 0.5,
  scrollRef: externalScrollRef,
  headerRef: externalHeaderRef,
  className,
}: DataTableContainerProps) {
  // Refs for measuring
  const containerRef = useRef<HTMLDivElement>(null);
  const controlsRef = useRef<HTMLDivElement>(null);
  const internalHeaderRef = useRef<HTMLDivElement>(null);
  const internalScrollRef = useRef<HTMLDivElement>(null);

  // Use external refs if provided, otherwise use internal
  const headerRef = externalHeaderRef || internalHeaderRef;
  const scrollRef = externalScrollRef || internalScrollRef;

  // State
  const [autoCollapsed, setAutoCollapsed] = useState(false);
  const [isPinned, setIsPinned] = useState(false);
  const [pinnedState, setPinnedState] = useState(false);
  const [isScrolled, setIsScrolled] = useState(false);

  // Auto-collapse based on controls panel height vs container height
  useEffect(() => {
    const container = containerRef.current;
    const controls = controlsRef.current;
    const header = headerRef.current;
    if (!container || !controls || !header) return;

    let rafId: number;
    const measure = () => {
      const containerH = container.clientHeight;
      // Controls panel = header bar (41px) + controls content + table header
      const controlsPanelH = 41 + controls.scrollHeight + header.clientHeight;
      if (containerH > 0 && controlsPanelH > 0) {
        setAutoCollapsed(controlsPanelH > containerH * collapseThreshold);
      }
    };

    rafId = requestAnimationFrame(measure);

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
  }, [collapseThreshold, headerRef]);

  // Scroll handling: shadow effect + horizontal sync
  useEffect(() => {
    const scroll = scrollRef.current;
    const header = headerRef.current;
    if (!scroll) return;

    let wasScrolled = false;
    const handleScroll = () => {
      const scrolled = scroll.scrollTop > 0;
      if (scrolled !== wasScrolled) {
        wasScrolled = scrolled;
        setIsScrolled(scrolled);
      }
      if (header) header.scrollLeft = scroll.scrollLeft;
    };

    scroll.addEventListener("scroll", handleScroll, { passive: true });
    return () => scroll.removeEventListener("scroll", handleScroll);
  }, [scrollRef, headerRef]);

  // Effective collapsed: pinned state takes precedence
  const effectiveCollapsed = isPinned ? pinnedState : autoCollapsed;

  // Toggle expand/collapse (pins if not already pinned)
  const handleToggle = () => {
    if (isPinned) {
      setPinnedState(prev => !prev);
    } else {
      setIsPinned(true);
      setPinnedState(!autoCollapsed);
    }
  };

  // Toggle pin mode
  const handlePinToggle = () => {
    if (!isPinned) setPinnedState(effectiveCollapsed);
    setIsPinned(!isPinned);
  };

  return (
    <div
      ref={containerRef}
      className={cn(
        "flex h-full flex-col overflow-hidden rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950",
        className
      )}
      style={{ contain: "strict" }}
    >
      {/* Filter Header */}
      <div className="shrink-0 border-b border-zinc-100 bg-zinc-50/50 dark:border-zinc-800/50 dark:bg-zinc-900/30">
        <div className="flex items-center">
          <button
            onClick={handleToggle}
            aria-expanded={!effectiveCollapsed}
            aria-controls="filter-content"
            className="flex flex-1 items-center justify-between px-4 py-2 text-left transition-colors hover:bg-zinc-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--nvidia-green)] dark:hover:bg-zinc-900/50"
          >
            <div className="flex items-center gap-2">
              <Filter className="h-3.5 w-3.5 text-zinc-400" />
              <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                Filters & Summary
              </span>
              {filterCount > 0 && (
                <span className="rounded-full bg-[var(--nvidia-green)] px-1.5 py-0.5 text-[10px] font-medium text-white">
                  {filterCount}
                </span>
              )}
              <span className="text-zinc-300 dark:text-zinc-600">·</span>
              <span className="text-xs text-zinc-400 dark:text-zinc-500">
                {effectiveCollapsed ? "click to expand" : "click to collapse"}
              </span>
            </div>
          </button>

          {/* Pin/Unpin button */}
          <div className="border-l border-zinc-100 px-2 dark:border-zinc-800/50">
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={handlePinToggle}
                  className={cn(
                    "rounded p-1.5 transition-colors",
                    isPinned
                      ? "bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300"
                      : "text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800"
                  )}
                >
                  {isPinned ? <Pin className="h-3.5 w-3.5" /> : <PinOff className="h-3.5 w-3.5" />}
                </button>
              </TooltipTrigger>
              <TooltipContent>
                {isPinned ? "Unpin (enable auto-collapse)" : "Pin (disable auto-collapse)"}
              </TooltipContent>
            </Tooltip>
          </div>

          {/* Compact mode button (optional) */}
          {onCompactModeChange && (
            <div className="border-l border-zinc-100 px-2 dark:border-zinc-800/50">
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => onCompactModeChange(!compactMode)}
                    className={cn(
                      "rounded p-1.5 transition-colors",
                      compactMode
                        ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                        : "text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800"
                    )}
                  >
                    {compactMode ? <Rows4 className="h-3.5 w-3.5" /> : <Rows3 className="h-3.5 w-3.5" />}
                  </button>
                </TooltipTrigger>
                <TooltipContent>{compactMode ? "Comfortable view" : "Compact view"}</TooltipContent>
              </Tooltip>
            </div>
          )}
        </div>
      </div>

      {/* Filter Content - always rendered for measurement, CSS Grid for smooth transition */}
      <div
        className="grid shrink-0 transition-[grid-template-rows] duration-150 ease-out"
        style={{ gridTemplateRows: effectiveCollapsed ? "0fr" : "1fr" }}
        aria-hidden={effectiveCollapsed}
      >
        <div className="min-h-0 overflow-hidden">
          <div
            ref={controlsRef}
            id="filter-content"
            className="space-y-4 border-b border-zinc-100 bg-zinc-50/50 p-4 dark:border-zinc-800/50 dark:bg-zinc-900/30"
          >
            {filters}
            {summary}
          </div>
        </div>
      </div>

      {/* Table Header - horizontal scroll synced with content */}
      <div
        ref={headerRef as React.RefObject<HTMLDivElement>}
        className={cn(
          "scrollbar-none shrink-0 overflow-x-auto transition-shadow",
          "bg-[var(--nvidia-green-bg)] dark:bg-[var(--nvidia-green-bg-dark)]",
          isScrolled && "shadow-md"
        )}
      >
        <div style={{ minWidth }}>
          {tableHeader}
        </div>
      </div>

      {/* Table Content - horizontal + vertical scroll */}
      <div ref={scrollRef as React.RefObject<HTMLDivElement>} className="flex-1 overflow-auto">
        <div style={{ minWidth }}>
          {tableBody}
        </div>
      </div>
    </div>
  );
}
