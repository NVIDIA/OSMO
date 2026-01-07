// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION. All rights reserved.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
//
// SPDX-License-Identifier: Apache-2.0

"use client";

import { memo } from "react";
import { cn } from "@/lib/utils";
import { chip } from "@/lib/styles";
import { useExpandableChips } from "@/hooks";

// =============================================================================
// Types
// =============================================================================

export interface ExpandableChipsProps {
  /** Array of string items to display as chips */
  items: string[];
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
 * Uses CSS-driven measurement - no configuration needed. Measures actual
 * rendered chip widths to calculate how many fit in the container.
 *
 * @example
 * ```tsx
 * <ExpandableChips items={["alpha", "beta", "gamma"]} />
 * ```
 */
export const ExpandableChips = memo(function ExpandableChips({
  items,
  expandable = true,
  onItemClick,
  chipClassName,
  emptyText = "—",
  collapseLabel = "show less",
}: ExpandableChipsProps) {
  const { containerRef, measureRef, expanded, setExpanded, sortedItems, displayedItems, overflowCount, visibleCount } =
    useExpandableChips({ items });

  if (sortedItems.length === 0) {
    return <span className="text-xs text-zinc-400 dark:text-zinc-500">{emptyText}</span>;
  }

  const isClickable = !!onItemClick;
  const ChipComponent = isClickable ? "button" : "span";

  const baseChipClass = cn(
    "inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap",
    chip.unselected,
    chipClassName,
  );

  return (
    <div className="relative overflow-hidden">
      {/* Hidden measurement container - CSS containment for 60fps performance */}
      <div
        ref={measureRef}
        className="pointer-events-none invisible absolute flex items-center gap-1"
        style={{ contain: "layout style", willChange: "contents" }}
        aria-hidden="true"
      >
        {sortedItems.map((item) => (
          <span
            key={item}
            data-chip
            className={baseChipClass}
          >
            {item}
          </span>
        ))}
        <span
          data-overflow
          className={cn(
            "inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-xs font-medium",
            chip.action,
          )}
        >
          +{overflowCount || 1}
        </span>
      </div>

      {/* Visible container */}
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
              baseChipClass,
              isClickable &&
                "cursor-pointer hover:border-zinc-300 hover:text-zinc-600 dark:hover:border-zinc-600 dark:hover:text-zinc-300",
              expanded && "max-w-full truncate",
            )}
            title={item}
          >
            <span className={expanded ? "truncate" : undefined}>{item}</span>
          </ChipComponent>
        ))}

        {/* Overflow indicator */}
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

        {/* Collapse button */}
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
    </div>
  );
});
