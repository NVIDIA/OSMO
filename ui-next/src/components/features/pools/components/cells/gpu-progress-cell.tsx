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

import { memo } from "react";
import { Share2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { progressTrack, getProgressColor } from "@/lib/styles";
import type { Quota } from "@/lib/api/adapter";

export interface GpuProgressCellProps {
  quota: Quota;
  type: "quota" | "capacity";
  displayMode: "used" | "free";
  compact?: boolean;
  isShared?: boolean;
  /** Callback when share icon is clicked - filters to show only pools in the same sharing group */
  onFilterBySharedPools?: () => void;
}

export const GpuProgressCell = memo(function GpuProgressCell({
  quota,
  type,
  displayMode,
  compact = false,
  isShared = false,
  onFilterBySharedPools,
}: GpuProgressCellProps) {
  const used = type === "quota" ? quota.used : quota.totalUsage;
  const total = type === "quota" ? quota.limit : quota.totalCapacity;
  const free = type === "quota" ? quota.free : quota.totalFree;
  const percent = total > 0 ? (used / total) * 100 : 0;
  const displayLabel = displayMode === "used" ? `${used}/${total}` : `${free} ${type === "quota" ? "free" : "idle"}`;

  const handleShareClick = onFilterBySharedPools
    ? (e: React.MouseEvent) => {
        e.stopPropagation(); // Don't trigger row selection
        onFilterBySharedPools();
      }
    : undefined;

  const shareIconClasses = onFilterBySharedPools
    ? "cursor-pointer hover:text-violet-600 dark:hover:text-violet-300 transition-colors"
    : "cursor-help";

  if (compact) {
    return (
      <div className="flex items-center gap-1.5">
        <span className="tabular-nums text-xs text-zinc-700 dark:text-zinc-300">{displayLabel}</span>
        {isShared && (
          <Share2
            className={cn("h-3 w-3 text-violet-500 dark:text-violet-400", shareIconClasses)}
            aria-label="Shares capacity with other pools - click to filter"
            onClick={handleShareClick}
          />
        )}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <div className={cn(progressTrack, "pools-progress-track h-2 w-16 flex-shrink-0")}>
        <div
          className={cn("h-full rounded-full transition-all", getProgressColor(percent))}
          style={{ width: `${Math.min(percent, 100)}%` }}
        />
      </div>
      <span className="whitespace-nowrap tabular-nums text-xs text-zinc-600 dark:text-zinc-400">{displayLabel}</span>
      {isShared && (
        <Share2
          className={cn("h-3.5 w-3.5 text-violet-500 dark:text-violet-400", shareIconClasses)}
          aria-label="Shares capacity with other pools - click to filter"
          onClick={handleShareClick}
        />
      )}
    </div>
  );
});
