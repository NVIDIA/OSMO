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

import { memo, useCallback } from "react";
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

  const handleShareClick = useCallback(
    (e: React.MouseEvent | React.KeyboardEvent) => {
      e.stopPropagation();
      onFilterBySharedPools?.();
    },
    [onFilterBySharedPools]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        handleShareClick(e);
      }
    },
    [handleShareClick]
  );

  // Shared icon component for both compact and full modes
  const ShareIcon = isShared ? (
    onFilterBySharedPools ? (
      <button
        type="button"
        onClick={handleShareClick}
        onKeyDown={handleKeyDown}
        className="inline-flex items-center justify-center rounded p-0.5 text-violet-500 transition-colors hover:bg-violet-100 hover:text-violet-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 dark:text-violet-400 dark:hover:bg-violet-900/30 dark:hover:text-violet-300"
        aria-label="Filter to show only pools sharing capacity with this pool"
      >
        <Share2 className={compact ? "h-3 w-3" : "h-3.5 w-3.5"} aria-hidden="true" />
      </button>
    ) : (
      <Share2
        className={cn(
          "text-violet-500 dark:text-violet-400",
          compact ? "h-3 w-3" : "h-3.5 w-3.5"
        )}
        aria-label="This pool shares capacity with other pools"
      />
    )
  ) : null;

  if (compact) {
    return (
      <div className="flex items-center gap-1.5">
        <span className="tabular-nums text-xs text-zinc-700 dark:text-zinc-300">{displayLabel}</span>
        {ShareIcon}
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
      {ShareIcon}
    </div>
  );
});
