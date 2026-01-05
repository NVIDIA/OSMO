// Copyright (c) 2026, NVIDIA CORPORATION. All rights reserved.
//
// NVIDIA CORPORATION and its licensors retain all intellectual property
// and proprietary rights in and to this software, related documentation
// and any modifications thereto. Any use, reproduction, disclosure or
// distribution of this software and related documentation without an express
// license agreement from NVIDIA CORPORATION is strictly prohibited.

"use client";

import { memo } from "react";
import { cn } from "@/lib/utils";
import { chip } from "@/lib/styles";
import { useExpandableChips, type ChipLayoutDimensions } from "@/hooks";

// =============================================================================
// Default Layout
// =============================================================================

const DEFAULT_LAYOUT: ChipLayoutDimensions = {
  overflowButtonWidth: 32, // 2rem
  chipGap: 4, // 0.25rem
  chipPadding: 16, // 1rem
  charWidth: 7, // 0.4375rem
  containerPadding: 0,
};

// =============================================================================
// Types
// =============================================================================

export interface ExpandableChipsProps {
  /** Array of string items to display as chips */
  items: string[];
  /** Optional custom layout dimensions */
  layout?: ChipLayoutDimensions;
  /** Whether expansion is allowed */
  expandable?: boolean;
  /** Callback when a chip is clicked */
  onItemClick?: (item: string) => void;
  /** Custom class for each chip */
  chipClassName?: string;
  /** Text to show when there are no items */
  emptyText?: string;
  /** Label for collapse button */
  collapseLabel?: string;
}

// =============================================================================
// Component
// =============================================================================

/**
 * ExpandableChips - Generic expandable chip list.
 *
 * Displays a row of chips that can expand to wrap when there are more
 * items than fit in a single line. Shows "+N" overflow indicator when
 * collapsed, and "show less" button when expanded.
 *
 * Uses the `useExpandableChips` hook for width calculation and state.
 *
 * @example
 * ```tsx
 * // Basic usage
 * <ExpandableChips items={["alpha", "beta", "gamma"]} />
 *
 * // With click handler
 * <ExpandableChips
 *   items={platforms}
 *   onItemClick={(platform) => console.log(platform)}
 * />
 *
 * // Non-expandable (static chips)
 * <ExpandableChips items={tags} expandable={false} />
 * ```
 */
export const ExpandableChips = memo(function ExpandableChips({
  items,
  layout = DEFAULT_LAYOUT,
  expandable = true,
  onItemClick,
  chipClassName,
  emptyText = "—",
  collapseLabel = "show less",
}: ExpandableChipsProps) {
  const { containerRef, expanded, setExpanded, sortedItems, displayedItems, overflowCount, visibleCount } =
    useExpandableChips({ items, layout });

  if (sortedItems.length === 0) {
    return <span className="text-xs text-zinc-400 dark:text-zinc-500">{emptyText}</span>;
  }

  const isClickable = !!onItemClick;
  const ChipComponent = isClickable ? "button" : "span";

  return (
    <div
      ref={containerRef}
      className={cn("flex items-center gap-1", expanded ? "flex-wrap" : "flex-nowrap overflow-hidden")}
    >
      {displayedItems.map((item) => (
        <ChipComponent
          key={item}
          type={isClickable ? "button" : undefined}
          onClick={
            isClickable
              ? (e) => {
                  e.stopPropagation();
                  onItemClick(item);
                }
              : undefined
          }
          className={cn(
            "inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-xs font-medium",
            "whitespace-nowrap",
            chip.unselected,
            isClickable &&
              "cursor-pointer hover:border-zinc-300 hover:text-zinc-600 dark:hover:border-zinc-600 dark:hover:text-zinc-300",
            expanded && "max-w-full truncate",
            chipClassName,
          )}
          title={item}
        >
          <span className={expanded ? "truncate" : undefined}>{item}</span>
        </ChipComponent>
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
            expandable && "cursor-pointer hover:bg-zinc-100 dark:hover:bg-zinc-800",
          )}
          title={`${overflowCount} more: ${sortedItems.slice(visibleCount).join(", ")}`}
          disabled={!expandable}
          aria-expanded={false}
          aria-label={`Show ${overflowCount} more items`}
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
            "cursor-pointer hover:bg-zinc-100 dark:hover:bg-zinc-800",
          )}
          aria-expanded={true}
          aria-label="Show fewer items"
        >
          {collapseLabel}
        </button>
      )}
    </div>
  );
});
