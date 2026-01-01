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

import { memo, useState, useMemo, useRef, useEffect, useCallback } from "react";
import { cn } from "@/lib/utils";
import { chip } from "@/lib/styles";

/** Approximate width of "+N" button in pixels */
const OVERFLOW_BUTTON_WIDTH = 32;
/** Gap between chips in pixels */
const CHIP_GAP = 4;
/** Padding inside chip (px-2 = 8px each side) */
const CHIP_PADDING = 16;
/** Approximate character width for chip text */
const CHAR_WIDTH = 7;

export interface PlatformPillsProps {
  /** List of platform names */
  platforms: string[];
  /** Whether to allow expansion */
  expandable?: boolean;
}

/**
 * PlatformPills - Expandable chip list for platforms
 * 
 * Behavior:
 * - Collapsed: Single line, shows as many chips as fit + "+N" overflow
 * - Always shows at least 1 chip
 * - Chips ordered alphabetically
 * - On expand: chips can wrap, "show less" appears at end
 */
export const PlatformPills = memo(function PlatformPills({
  platforms,
  expandable = true,
}: PlatformPillsProps) {
  const [expanded, setExpanded] = useState(false);
  const [visibleCount, setVisibleCount] = useState(1);
  const containerRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);

  // Sort platforms alphabetically
  const sortedPlatforms = useMemo(
    () => [...platforms].sort((a, b) => a.localeCompare(b)),
    [platforms]
  );

  // Estimate chip width based on text length
  const estimateChipWidth = useCallback((text: string) => {
    return text.length * CHAR_WIDTH + CHIP_PADDING;
  }, []);

  // Calculate how many chips fit in available width
  const calculateVisibleCount = useCallback(() => {
    if (!containerRef.current || sortedPlatforms.length === 0) return 1;

    const containerWidth = containerRef.current.offsetWidth;
    if (containerWidth === 0) return 1;

    let usedWidth = 0;
    let count = 0;
    const hasOverflow = sortedPlatforms.length > 1;

    for (let i = 0; i < sortedPlatforms.length; i++) {
      const chipWidth = estimateChipWidth(sortedPlatforms[i]);
      const needsOverflowSpace = hasOverflow && i < sortedPlatforms.length - 1;
      const requiredWidth = usedWidth + chipWidth + (count > 0 ? CHIP_GAP : 0);
      const reservedForOverflow = needsOverflowSpace ? OVERFLOW_BUTTON_WIDTH + CHIP_GAP : 0;

      if (requiredWidth + reservedForOverflow <= containerWidth) {
        usedWidth = requiredWidth;
        count++;
      } else {
        break;
      }
    }

    // Always show at least 1 chip
    return Math.max(1, count);
  }, [sortedPlatforms, estimateChipWidth]);

  // Recalculate on resize
  useEffect(() => {
    if (expanded) return; // Don't resize when expanded

    const container = containerRef.current;
    if (!container) return;

    const observer = new ResizeObserver(() => {
      setVisibleCount(calculateVisibleCount());
    });

    observer.observe(container);
    setVisibleCount(calculateVisibleCount());

    return () => observer.disconnect();
  }, [calculateVisibleCount, expanded, sortedPlatforms]);

  // Reset to collapsed when platforms change
  useEffect(() => {
    setExpanded(false);
  }, [platforms]);

  const displayedPlatforms = expanded
    ? sortedPlatforms
    : sortedPlatforms.slice(0, visibleCount);
  const overflowCount = sortedPlatforms.length - visibleCount;

  if (sortedPlatforms.length === 0) {
    return <span className="text-xs text-zinc-400 dark:text-zinc-500">—</span>;
  }

  return (
    <div
      ref={containerRef}
      className={cn(
        "flex items-center gap-1",
        expanded ? "flex-wrap" : "flex-nowrap overflow-hidden"
      )}
    >
      {displayedPlatforms.map((platform) => (
        <span
          key={platform}
          className={cn(
            "inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-xs font-medium",
            "whitespace-nowrap",
            chip.unselected,
            expanded && "max-w-full truncate"
          )}
          title={platform}
        >
          <span className={expanded ? "truncate" : undefined}>{platform}</span>
        </span>
      ))}

      {/* Overflow indicator - only show when collapsed and there's overflow */}
      {!expanded && overflowCount > 0 && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            if (expandable) setExpanded(true);
          }}
          className={cn(
            "inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-xs font-medium",
            chip.action,
            expandable && "cursor-pointer hover:bg-zinc-100 dark:hover:bg-zinc-800"
          )}
          title={`${overflowCount} more: ${sortedPlatforms.slice(visibleCount).join(", ")}`}
          disabled={!expandable}
        >
          +{overflowCount}
        </button>
      )}

      {/* Collapse button - only show when expanded and there was overflow */}
      {expanded && sortedPlatforms.length > 1 && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setExpanded(false);
          }}
          className={cn(
            "inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-xs font-medium",
            chip.action,
            "cursor-pointer hover:bg-zinc-100 dark:hover:bg-zinc-800"
          )}
        >
          show less
        </button>
      )}

      {/* Hidden measure container for accurate width calculation */}
      <div ref={measureRef} className="invisible absolute" aria-hidden="true" />
    </div>
  );
});
