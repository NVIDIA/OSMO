"use client";

// Copyright (c) 2025, NVIDIA CORPORATION. All rights reserved.
//
// NVIDIA CORPORATION and its licensors retain all intellectual property
// and proprietary rights in and to this software, related documentation
// and any modifications thereto. Any use, reproduction, disclosure or
// distribution of this software and related documentation without an express
// license agreement from NVIDIA CORPORATION is strictly prohibited.

import { useState, useRef, useLayoutEffect, useCallback } from "react";
import Link from "next/link";
import { ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";

interface ResponsivePoolChipsProps {
  /** All pool names to display */
  pools: string[];
  /** Primary pool to highlight (usually the context pool) */
  primaryPool?: string | null;
  /** Whether pools are still loading */
  isLoading?: boolean;
  /** Additional className for the container */
  className?: string;
}

/**
 * Responsive pool chips that collapse to fit available width.
 *
 * Behavior:
 * - Shows as many chips as fit in one line
 * - Shows +N overflow indicator when chips are hidden
 * - Clicking +N expands to show all chips wrapped
 * - "Less" button collapses back to single line
 * - Dynamically adjusts to container width changes
 */
export function ResponsivePoolChips({
  pools,
  primaryPool,
  isLoading = false,
  className,
}: ResponsivePoolChipsProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const [isExpanded, setIsExpanded] = useState(false);
  const [visibleCount, setVisibleCount] = useState(pools.length);
  const [hasMeasured, setHasMeasured] = useState(false);

  // Key for triggering recalculation when pools change
  const poolsKey = pools.join(",");

  // Calculate how many chips fit in collapsed mode
  const calculateVisibleChips = useCallback(() => {
    if (!containerRef.current || !measureRef.current || isExpanded) {
      setVisibleCount(pools.length);
      return;
    }

    const containerWidth = containerRef.current.clientWidth;
    const chips = measureRef.current.querySelectorAll<HTMLElement>("[data-measure-chip]");

    if (chips.length === 0) {
      setVisibleCount(pools.length);
      setHasMeasured(true);
      return;
    }

    const GAP = 6; // gap-1.5 = 6px
    const OVERFLOW_WIDTH = 40; // Width for "+N" button

    let totalWidth = 0;
    let count = 0;

    for (let i = 0; i < chips.length; i++) {
      const chip = chips[i];
      const chipWidth = chip.offsetWidth;
      const widthWithChip = totalWidth + chipWidth + (count > 0 ? GAP : 0);

      // Check if we need overflow indicator
      const isLast = i === chips.length - 1;
      const requiredWidth = isLast
        ? widthWithChip
        : widthWithChip + GAP + OVERFLOW_WIDTH;

      if (requiredWidth > containerWidth && count > 0) {
        break;
      }

      totalWidth = widthWithChip;
      count++;
    }

    setVisibleCount(Math.max(1, count)); // Always show at least 1
    setHasMeasured(true);
  }, [pools.length, isExpanded]);

  // Recalculate on mount, resize, and pool changes
  useLayoutEffect(() => {
    // Calculate after a frame to ensure DOM is ready
    // Reset measurement state and recalculate (async setState is allowed)
    requestAnimationFrame(() => {
      setHasMeasured(false);
      calculateVisibleChips();
    });

    if (!containerRef.current) return;

    const observer = new ResizeObserver(() => {
      if (!isExpanded) {
        calculateVisibleChips();
      }
    });

    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [calculateVisibleChips, isExpanded, poolsKey]);

  // Recalculate when collapsing
  useLayoutEffect(() => {
    if (!isExpanded) {
      requestAnimationFrame(calculateVisibleChips);
    }
  }, [isExpanded, calculateVisibleChips]);

  if (isLoading) {
    return (
      <div className={cn("flex items-center gap-2", className)}>
        <div className="h-6 w-20 animate-pulse rounded-full bg-zinc-200 dark:bg-zinc-800" />
        <div className="h-6 w-16 animate-pulse rounded-full bg-zinc-200 dark:bg-zinc-800" />
      </div>
    );
  }

  if (pools.length === 0) {
    return (
      <span className="text-sm text-zinc-500 dark:text-zinc-400">
        No pools
      </span>
    );
  }

  const hiddenCount = pools.length - visibleCount;
  const showOverflow = !isExpanded && hiddenCount > 0;
  const visiblePools = isExpanded ? pools : pools.slice(0, visibleCount);

  return (
    <div ref={containerRef} className={cn("min-w-0", className)}>
      {/* Hidden measurement container - renders all chips to measure */}
      <div
        ref={measureRef}
        className="pointer-events-none absolute -left-[9999px] flex gap-1.5"
        aria-hidden="true"
      >
        {pools.map((pool) => (
          <span
            key={pool}
            data-measure-chip
            className="shrink-0 rounded-full border px-3 py-1 text-xs font-medium"
          >
            {pool}
          </span>
        ))}
      </div>

      {/* Visible chips */}
      <div
        className={cn(
          "flex gap-1.5",
          isExpanded ? "flex-wrap" : "flex-nowrap",
          // Hide until measured to prevent flash
          !hasMeasured && !isExpanded && "opacity-0"
        )}
      >
        {visiblePools.map((pool) => {
          const isPrimary = pool === primaryPool;

          return (
            <Link
              key={pool}
              href={`/pools/${pool}`}
              className={cn(
                "shrink-0 rounded-full px-3 py-1 text-xs font-medium transition-colors",
                "border hover:opacity-80",
                isPrimary
                  ? "border-[var(--nvidia-green)]/30 bg-[var(--nvidia-green)]/10 text-[var(--nvidia-green)]"
                  : "border-zinc-200 bg-zinc-100 text-zinc-700 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
              )}
              onClick={(e) => e.stopPropagation()}
            >
              {pool}
            </Link>
          );
        })}

        {/* Overflow indicator */}
        {showOverflow && (
          <button
            type="button"
            onClick={() => setIsExpanded(true)}
            className="shrink-0 rounded-full border border-zinc-300 bg-zinc-200 px-2.5 py-1 text-xs font-semibold text-zinc-600 transition-colors hover:bg-zinc-300 dark:border-zinc-600 dark:bg-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-600"
            aria-label={`Show ${hiddenCount} more pool${hiddenCount > 1 ? "s" : ""}`}
          >
            +{hiddenCount}
          </button>
        )}

        {/* Collapse button */}
        {isExpanded && pools.length > 1 && (
          <button
            type="button"
            onClick={() => setIsExpanded(false)}
            className="shrink-0 inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
            aria-label="Show fewer pools"
          >
            <ChevronUp className="h-3 w-3" />
            Less
          </button>
        )}
      </div>
    </div>
  );
}
