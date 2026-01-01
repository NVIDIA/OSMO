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
import { cn } from "@/lib/utils";
import { progressTrack, getProgressColor } from "@/lib/styles";
import type { Quota } from "@/lib/api/adapter";

export interface GpuProgressCellProps {
  quota: Quota;
  type: "quota" | "capacity";
  displayMode: "used" | "free";
  compact?: boolean;
  isShared?: boolean;
}

export const GpuProgressCell = memo(function GpuProgressCell({
  quota,
  type,
  displayMode,
  compact = false,
  isShared = false,
}: GpuProgressCellProps) {
  const used = type === "quota" ? quota.used : quota.totalUsage;
  const total = type === "quota" ? quota.limit : quota.totalCapacity;
  const free = type === "quota" ? quota.free : quota.totalFree;
  const percent = total > 0 ? (used / total) * 100 : 0;
  const displayLabel = displayMode === "used" ? `${used}/${total}` : `${free} ${type === "quota" ? "free" : "idle"}`;

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
      <div className={cn(progressTrack, "h-2 w-16 flex-shrink-0")}>
        <div
          className={cn("h-full rounded-full transition-all", getProgressColor(percent))}
          style={{ width: `${Math.min(percent, 100)}%` }}
        />
      </div>
      <span className="whitespace-nowrap tabular-nums text-xs text-zinc-600 dark:text-zinc-400">{displayLabel}</span>
      {isShared && <span className="cursor-help text-xs" title="Shares capacity with other pools">🔗</span>}
    </div>
  );
});
