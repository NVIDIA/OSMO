"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Cpu, ChevronDown, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { heading, chip } from "@/lib/styles";

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
  const [collapsedCount, setCollapsedCount] = useState(platforms.length);
  const containerRef = useRef<HTMLDivElement>(null);
  const chipsRef = useRef<(HTMLButtonElement | null)[]>([]);

  const isInteractive = !!onToggle;
  const hasFilter = selectedPlatforms.size > 0;

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
      const chipEl = chipsRef.current[i];
      const chipWidth = chipEl?.offsetWidth ?? ESTIMATED_CHIP_WIDTH;
      const widthWithGap = chipWidth + (count > 0 ? CHIP_GAP : 0);
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

    setCollapsedCount(Math.max(1, count));
  }, [platforms.length]);

  useEffect(() => {
    calculateCollapsedCount();
    const observer = new ResizeObserver(() => calculateCollapsedCount());
    if (containerRef.current) observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [calculateCollapsedCount]);

  useEffect(() => {
    const timer = setTimeout(calculateCollapsedCount, 0);
    return () => clearTimeout(timer);
  }, [platforms, calculateCollapsedCount]);

  const hasOverflow = collapsedCount < platforms.length;
  const visiblePlatforms = isExpanded
    ? platforms
    : platforms.slice(0, collapsedCount);
  const hiddenCount = platforms.length - collapsedCount;

  return (
    <div className="space-y-2">
      {/* Header */}
      <div className="flex items-center gap-2">
        <Cpu className="h-4 w-4 text-zinc-400" />
        <h2 className={heading.section}>Platforms</h2>
        {/* Hint or Clear - same position, same styling */}
        {isInteractive && platforms.length > 1 && (
          hasFilter && onClearFilter ? (
            <button
              onClick={onClearFilter}
              className={`${heading.meta} flex items-center gap-1 hover:text-zinc-600 dark:hover:text-zinc-300`}
            >
              · Clear
              <X className="h-3 w-3" />
            </button>
          ) : (
            <span className={heading.meta}>· Click to filter</span>
          )
        )}
      </div>

      {/* Chips */}
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
                isInteractive ? "cursor-pointer" : "cursor-default",
                showAsSelected && chip.selected,
                showAsSelected && isInteractive && chip.selectedHover,
                !showAsSelected && chip.unselected,
                !showAsSelected && isInteractive && chip.unselectedHover
              )}
            >
              {platform}
            </button>
          );
        })}

        {hasOverflow && (
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className={cn(
              "flex shrink-0 items-center gap-1 rounded-full border px-3 py-1 text-sm transition-colors",
              chip.action
            )}
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
