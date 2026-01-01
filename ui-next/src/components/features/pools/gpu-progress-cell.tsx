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
 * GPU Progress Cell Component
 *
 * Displays GPU quota or capacity as a progress bar with number.
 * Supports "used" and "free" display modes.
 */

"use client";

import { memo } from "react";
import { cn } from "@/lib/utils";
import { progressTrack, getProgressColor } from "@/lib/styles";
import type { Quota } from "@/lib/api/adapter";

export interface GpuProgressCellProps {
  /** Quota object containing usage data */
  quota: Quota;
  /** Which metric to display: "quota" for user quota, "capacity" for pool capacity */
  type: "quota" | "capacity";
  /** Display mode: "used" shows usage, "free" shows available */
  displayMode: "used" | "free";
  /** Whether to show compact view (number only, no bar) */
  compact?: boolean;
  /** Whether this pool shares capacity with others */
  isShared?: boolean;
  /** Pools that share capacity (for tooltip) */
  sharedWith?: string[];
}

export const GpuProgressCell = memo(function GpuProgressCell({
  quota,
  type,
  displayMode,
  compact = false,
  isShared = false,
}: GpuProgressCellProps) {
  // Calculate values based on type
  const used = type === "quota" ? quota.used : quota.totalUsage;
  const total = type === "quota" ? quota.limit : quota.totalCapacity;
  const free = type === "quota" ? quota.free : quota.totalFree;

  // Calculate percentage (guard against division by zero)
  const percent = total > 0 ? (used / total) * 100 : 0;

  // Display value based on mode
  const displayValue = displayMode === "used" ? used : free;
  const displayLabel = displayMode === "used" ? `${used}/${total}` : `${free} ${type === "quota" ? "free" : "idle"}`;

  // Compact mode: just show the number
  if (compact) {
    return (
      <div className="flex items-center gap-1">
        <span className="tabular-nums text-xs text-zinc-700 dark:text-zinc-300">{displayLabel}</span>
        {isShared && <span title="Shares capacity with other pools">🔗</span>}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      {/* Progress bar */}
      <div className={cn(progressTrack, "h-2 w-16 flex-shrink-0")}>
        <div
          className={cn("h-full rounded-full transition-all", getProgressColor(percent))}
          style={{ width: `${Math.min(percent, 100)}%` }}
        />
      </div>

      {/* Label */}
      <span className="whitespace-nowrap tabular-nums text-xs text-zinc-600 dark:text-zinc-400">{displayLabel}</span>

      {/* Sharing indicator */}
      {isShared && (
        <span className="cursor-help text-xs" title="Shares capacity with other pools">
          🔗
        </span>
      )}
    </div>
  );
});
