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

import { useMemo } from "react";
import { ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import { useExpandableChips } from "@/lib/hooks";
import { getChipLayoutSpacious } from "../../hooks/use-layout-dimensions";

// =============================================================================
// Types
// =============================================================================

interface SharedPoolsChipsProps {
  /** Pool names that share capacity with the current pool */
  pools: string[];
  /** Callback when a pool chip is clicked */
  onPoolClick?: (poolName: string) => void;
}

// =============================================================================
// Component
// =============================================================================

/**
 * Shared Pools Chips - Expandable chip list for shared capacity pools.
 *
 * Uses the generic `useExpandableChips` hook with pool-specific styling.
 * Chips are clickable and navigate to the selected pool.
 */
export function SharedPoolsChips({ pools, onPoolClick }: SharedPoolsChipsProps) {
  const layout = useMemo(() => getChipLayoutSpacious(), []);

  const {
    containerRef,
    expanded,
    setExpanded,
    sortedItems,
    displayedItems,
    overflowCount,
    visibleCount,
  } = useExpandableChips({ items: pools, layout });

  return (
    <div
      ref={containerRef}
      className={cn(
        "flex w-full items-center gap-1.5 -m-0.5 p-0.5",
        expanded ? "flex-wrap" : "flex-nowrap overflow-hidden"
      )}
    >
      {displayedItems.map((poolName) => (
        <button
          key={poolName}
          type="button"
          onClick={() => onPoolClick?.(poolName)}
          className={cn(
            "group inline-flex shrink-0 items-center gap-1 rounded-md bg-white/60 px-2 py-1 text-xs font-medium text-zinc-700 ring-1 ring-inset ring-zinc-200 transition-colors hover:bg-violet-100 hover:text-violet-700 hover:ring-violet-300 dark:bg-zinc-800/60 dark:text-zinc-300 dark:ring-zinc-700 dark:hover:bg-violet-900/50 dark:hover:text-violet-300 dark:hover:ring-violet-600",
            expanded && "max-w-full"
          )}
          title={`View ${poolName}`}
        >
          <span className={expanded ? "truncate" : undefined}>{poolName}</span>
          <ExternalLink className="size-3 opacity-0 transition-opacity group-hover:opacity-100" />
        </button>
      ))}

      {/* Overflow indicator */}
      {!expanded && overflowCount > 0 && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="inline-flex shrink-0 items-center rounded-md bg-violet-100 px-2 py-1 text-xs font-medium text-violet-700 ring-1 ring-inset ring-violet-200 transition-colors hover:bg-violet-200 dark:bg-violet-900/50 dark:text-violet-300 dark:ring-violet-700 dark:hover:bg-violet-800/50"
          title={`${overflowCount} more: ${sortedItems.slice(visibleCount).join(", ")}`}
        >
          +{overflowCount}
        </button>
      )}

      {/* Collapse button */}
      {expanded && sortedItems.length > 1 && (
        <button
          type="button"
          onClick={() => setExpanded(false)}
          className="inline-flex shrink-0 items-center rounded-md bg-violet-100 px-2 py-1 text-xs font-medium text-violet-700 ring-1 ring-inset ring-violet-200 transition-colors hover:bg-violet-200 dark:bg-violet-900/50 dark:text-violet-300 dark:ring-violet-700 dark:hover:bg-violet-800/50"
        >
          less
        </button>
      )}
    </div>
  );
}
