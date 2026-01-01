/**
 * Copyright (c) 2025, NVIDIA CORPORATION. All rights reserved.
 *
 * NVIDIA CORPORATION and its licensors retain all intellectual property
 * and proprietary rights in and to this software, related documentation
 * and any modifications thereto. Any use, reproduction, disclosure or
 * distribution of this software and related documentation without an express
 * license agreement from NVIDIA CORPORATION is strictly prohibited.
 */

/**
 * Platform Pills Component
 *
 * Displays platform names as pills with responsive overflow:
 * - Shows as many pills as fit
 * - Shows "+N" for overflow
 * - Alphabetically sorted
 */

"use client";

import { memo, useState, useMemo } from "react";
import { cn } from "@/lib/utils";
import { chip } from "@/lib/styles";
import { PLATFORM } from "./constants";

export interface PlatformPillsProps {
  /** List of platform names */
  platforms: string[];
  /** Maximum visible pills (defaults to auto-calculate based on width) */
  maxVisible?: number;
  /** Whether to allow expansion */
  expandable?: boolean;
}

export const PlatformPills = memo(function PlatformPills({
  platforms,
  maxVisible = PLATFORM.MAX_VISIBLE,
  expandable = true,
}: PlatformPillsProps) {
  const [expanded, setExpanded] = useState(false);

  // Sort platforms alphabetically
  const sortedPlatforms = useMemo(() => [...platforms].sort((a, b) => a.localeCompare(b)), [platforms]);

  // Determine visible platforms
  const visibleCount = expanded ? sortedPlatforms.length : Math.min(maxVisible, sortedPlatforms.length);
  const visiblePlatforms = sortedPlatforms.slice(0, visibleCount);
  const overflowCount = sortedPlatforms.length - visibleCount;

  if (sortedPlatforms.length === 0) {
    return <span className="text-xs text-zinc-400 dark:text-zinc-500">—</span>;
  }

  return (
    <div className="flex flex-wrap items-center gap-1">
      {visiblePlatforms.map((platform) => (
        <span
          key={platform}
          className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium", chip.unselected)}
          title={platform}
        >
          {platform}
        </span>
      ))}

      {/* Overflow indicator */}
      {overflowCount > 0 && !expanded && (
        <button
          type="button"
          onClick={() => expandable && setExpanded(true)}
          className={cn(
            "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium",
            chip.action,
            expandable && "cursor-pointer",
          )}
          title={`${overflowCount} more: ${sortedPlatforms.slice(visibleCount).join(", ")}`}
          disabled={!expandable}
        >
          +{overflowCount}
        </button>
      )}

      {/* Collapse button */}
      {expanded && sortedPlatforms.length > maxVisible && (
        <button
          type="button"
          onClick={() => setExpanded(false)}
          className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium", chip.action)}
        >
          show less
        </button>
      )}
    </div>
  );
});
