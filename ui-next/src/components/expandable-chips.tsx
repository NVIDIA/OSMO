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
import { Badge } from "@/components/shadcn/badge";
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
    return <span className="text-xs text-muted-foreground">{emptyText}</span>;
  }

  const isClickable = !!onItemClick;

  return (
    <div className="relative w-full min-w-0 flex-1">
      {/* Hidden measurement container - CSS containment for 60fps performance */}
      <div
        ref={measureRef}
        className="pointer-events-none invisible absolute flex w-full items-center gap-1"
        style={{ contain: "layout style", willChange: "contents" }}
        aria-hidden="true"
      >
        {sortedItems.map((item) => (
          <Badge
            key={item}
            data-chip
            variant="outline"
            className={chipClassName}
          >
            {item}
          </Badge>
        ))}
        <Badge
          data-overflow
          variant="outline"
          className="border-dashed"
        >
          +{overflowCount || 1}
        </Badge>
      </div>

      {/* Visible container */}
      <div
        ref={containerRef}
        className={cn(
          "flex min-w-0 items-center gap-1",
          expanded ? "w-full flex-wrap content-start" : "flex-nowrap overflow-hidden"
        )}
      >
        {displayedItems.map((item) => (
          <Badge
            key={item}
            variant="outline"
            asChild={isClickable}
            className={cn(
              chipClassName,
              isClickable && "cursor-pointer hover:bg-accent",
              expanded && "max-w-full"
            )}
            title={item}
          >
            {isClickable ? (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onItemClick(item);
                }}
              >
                <span className={expanded ? "truncate" : undefined}>{item}</span>
              </button>
            ) : (
              <span className={expanded ? "truncate" : undefined}>{item}</span>
            )}
          </Badge>
        ))}

        {/* Overflow indicator */}
        {!expanded && overflowCount > 0 && (
          <Badge
            variant="outline"
            asChild
            className={cn(
              "border-dashed",
              expandable && "cursor-pointer hover:bg-accent"
            )}
            title={`${overflowCount} more: ${sortedItems.slice(visibleCount).join(", ")}`}
          >
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                if (expandable) setExpanded(true);
              }}
              disabled={!expandable}
              aria-expanded={false}
              aria-label={`Show ${overflowCount} more items`}
            >
              +{overflowCount}
            </button>
          </Badge>
        )}

        {/* Collapse button */}
        {expanded && sortedItems.length > 1 && (
          <Badge
            variant="outline"
            asChild
            className="cursor-pointer border-dashed hover:bg-accent"
          >
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setExpanded(false);
              }}
              aria-expanded={true}
              aria-label="Show fewer items"
            >
              {collapseLabel}
            </button>
          </Badge>
        )}
      </div>
    </div>
  );
});
