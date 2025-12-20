"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Cpu, ChevronDown, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

/** Approximate width of a chip (used for initial estimate) */
const ESTIMATED_CHIP_WIDTH = 100;
/** Width of the "more" button */
const MORE_BUTTON_WIDTH = 100;
/** Gap between chips */
const CHIP_GAP = 8;

interface PlatformChipsProps {
  platforms: string[];
  /** Currently selected platforms (empty = all shown, no filter) */
  selectedPlatforms?: Set<string>;
  /** Callback when a platform is toggled */
  onToggle?: (platform: string) => void;
  /** Callback to clear all filters */
  onClearFilter?: () => void;
}

export function PlatformChips({
  platforms,
  selectedPlatforms = new Set(),
  onToggle,
  onClearFilter,
}: PlatformChipsProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  // How many chips fit in one line (calculated dynamically)
  const [collapsedCount, setCollapsedCount] = useState(platforms.length);
  const containerRef = useRef<HTMLDivElement>(null);
  const chipsRef = useRef<(HTMLButtonElement | null)[]>([]);

  const isInteractive = !!onToggle;
  const hasFilter = selectedPlatforms.size > 0;

  // Calculate how many chips fit in one line
  const calculateCollapsedCount = useCallback(() => {
    const container = containerRef.current;
    if (!container || platforms.length === 0) {
      setCollapsedCount(platforms.length);
      return;
    }

    const containerWidth = container.offsetWidth;
    let totalWidth = 0;
    let count = 0;

    for (let i = 0; i < platforms.length; i++) {
      const chip = chipsRef.current[i];
      const chipWidth = chip?.offsetWidth ?? ESTIMATED_CHIP_WIDTH;
      const widthWithGap = chipWidth + (count > 0 ? CHIP_GAP : 0);

      // Reserve space for "more" button if not the last chip
      const remainingChips = platforms.length - (i + 1);
      const needsMoreButton = remainingChips > 0;
      const reservedWidth = needsMoreButton ? MORE_BUTTON_WIDTH + CHIP_GAP : 0;

      if (totalWidth + widthWithGap + reservedWidth <= containerWidth) {
        totalWidth += widthWithGap;
        count++;
      } else {
        break;
      }
    }

    // Show at least 1 chip
    setCollapsedCount(Math.max(1, count));
  }, [platforms.length]);

  // Recalculate on resize
  useEffect(() => {
    calculateCollapsedCount();

    const observer = new ResizeObserver(() => {
      calculateCollapsedCount();
    });

    if (containerRef.current) {
      observer.observe(containerRef.current);
    }

    return () => observer.disconnect();
  }, [calculateCollapsedCount]);

  // Recalculate when platforms change
  useEffect(() => {
    // Small delay to ensure chips are rendered
    const timer = setTimeout(calculateCollapsedCount, 0);
    return () => clearTimeout(timer);
  }, [platforms, calculateCollapsedCount]);

  // Derived state
  const hasOverflow = collapsedCount < platforms.length;
  const visiblePlatforms = isExpanded
    ? platforms
    : platforms.slice(0, collapsedCount);
  const hiddenCount = platforms.length - collapsedCount;

  return (
    <div className="space-y-2">
      {/* Header row with label and controls */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Cpu className="h-4 w-4 text-zinc-400" />
          <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
            Platforms
          </h2>
          {isInteractive && !hasFilter && platforms.length > 1 && (
            <span className="text-xs text-zinc-400 dark:text-zinc-500">
              · Click to filter
            </span>
          )}
        </div>

        {/* Clear filter button in header */}
        {hasFilter && onClearFilter && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onClearFilter}
            className="h-6 gap-1 px-2 text-xs text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
          >
            <X className="h-3 w-3" />
            Clear
          </Button>
        )}
      </div>

      {/* Chips container */}
      <div
        ref={containerRef}
        className={cn(
          "flex items-center gap-2",
          isExpanded ? "flex-wrap" : "flex-nowrap overflow-hidden"
        )}
      >
        {visiblePlatforms.map((platform, index) => {
          const isSelected = selectedPlatforms.has(platform);
          const showAsSelected = hasFilter ? isSelected : true;

          return (
            <button
              key={platform}
              ref={(el) => {
                chipsRef.current[index] = el;
              }}
              onClick={() => onToggle?.(platform)}
              disabled={!isInteractive}
              className={cn(
                "flex shrink-0 items-center rounded-full border px-3 py-1 text-sm font-medium transition-all",
                isInteractive && "cursor-pointer",
                !isInteractive && "cursor-default",
                // Selected state (or no filter active = all look selected)
                showAsSelected && [
                  "border-[#76b900] bg-[#76b900]/10 text-[#76b900]",
                  "dark:border-[#76b900] dark:bg-[#76b900]/20 dark:text-[#9ed439]",
                  isInteractive &&
                    "hover:bg-[#76b900]/20 dark:hover:bg-[#76b900]/30",
                ],
                // Unselected state (only when filter is active)
                !showAsSelected && [
                  "border-zinc-200 bg-zinc-50 text-zinc-400",
                  "dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-500",
                  isInteractive &&
                    "hover:border-zinc-300 hover:text-zinc-500 dark:hover:border-zinc-700 dark:hover:text-zinc-400",
                ]
              )}
            >
              {platform}
            </button>
          );
        })}

        {/* Show more/less toggle - only when there's overflow */}
        {hasOverflow && (
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="flex shrink-0 items-center gap-1 rounded-full border border-dashed border-zinc-300 px-3 py-1 text-sm text-zinc-500 transition-colors hover:border-zinc-400 hover:text-zinc-700 dark:border-zinc-700 dark:text-zinc-400 dark:hover:border-zinc-600 dark:hover:text-zinc-300"
          >
            {isExpanded ? (
              <>
                Show less
                <ChevronDown className="h-3.5 w-3.5 rotate-180" />
              </>
            ) : (
              <>
                +{hiddenCount} more
                <ChevronDown className="h-3.5 w-3.5" />
              </>
            )}
          </button>
        )}
      </div>
    </div>
  );
}
