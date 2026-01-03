/**
 * Copyright (c) 2025-2026, NVIDIA CORPORATION. All rights reserved.
 *
 * NVIDIA CORPORATION and its licensors retain all intellectual property
 * and proprietary rights in and to this software, related documentation
 * and any modifications thereto. Any use, reproduction, disclosure or
 * distribution of this software and related documentation without an express
 * license agreement from NVIDIA CORPORATION is strictly prohibited.
 */

"use client";

import { memo, useMemo } from "react";
import { cn } from "@/lib/utils";
import { chip } from "@/lib/styles";
import { getChipLayoutCompact } from "../../hooks/use-layout-dimensions";
import { useExpandableChips } from "@/lib/hooks";

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
  const layout = useMemo(() => getChipLayoutCompact(), []);

  const {
    containerRef,
    expanded,
    setExpanded,
    sortedItems,
    displayedItems,
    overflowCount,
    visibleCount,
  } = useExpandableChips({ items: platforms, layout });

  if (sortedItems.length === 0) {
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
      {displayedItems.map((platform) => (
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
          title={`${overflowCount} more: ${sortedItems.slice(visibleCount).join(", ")}`}
          disabled={!expandable}
          aria-expanded={false}
          aria-label={`Show ${overflowCount} more platforms`}
        >
          +{overflowCount}
        </button>
      )}

      {/* Collapse button - only show when expanded and there was overflow */}
      {expanded && sortedItems.length > 1 && (
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
          aria-expanded={true}
          aria-label="Show fewer platforms"
        >
          show less
        </button>
      )}
    </div>
  );
});
