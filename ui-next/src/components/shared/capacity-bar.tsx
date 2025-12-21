"use client";

// Copyright (c) 2025, NVIDIA CORPORATION. All rights reserved.
//
// NVIDIA CORPORATION and its licensors retain all intellectual property
// and proprietary rights in and to this software, related documentation
// and any modifications thereto. Any use, reproduction, disclosure or
// distribution of this software and related documentation without an express
// license agreement from NVIDIA CORPORATION is strictly prohibited.

import { cn, formatCompact } from "@/lib/utils";
import { getProgressColor } from "@/lib/styles";

// =============================================================================
// Types
// =============================================================================

export interface CapacityBarProps {
  /** Label for the capacity type (e.g., "GPU", "CPU") */
  label: string;
  /** Amount currently used */
  used: number;
  /** Total capacity */
  total: number;
  /** Optional unit suffix (e.g., "Gi", "cores") */
  unit?: string;
  /** Size variant */
  size?: "sm" | "md";
  /** Whether to show the "free" indicator below the bar */
  showFree?: boolean;
}

// =============================================================================
// Component
// =============================================================================

/**
 * Reusable capacity/usage bar component.
 *
 * Used across pool detail, resource detail, and fleet views to show
 * resource utilization (GPU, CPU, Memory, Storage).
 *
 * @example
 * ```tsx
 * <CapacityBar label="GPU" used={6} total={8} />
 * <CapacityBar label="Memory" used={256} total={512} unit="Gi" />
 * ```
 */
export function CapacityBar({
  label,
  used,
  total,
  unit = "",
  size = "md",
  showFree = true,
}: CapacityBarProps) {
  const free = total - used;
  const percent = total > 0 ? (used / total) * 100 : 0;
  const barColor = getProgressColor(percent);

  const barHeight = size === "sm" ? "h-1.5" : "h-2";
  const textSize = size === "sm" ? "text-xs" : "text-sm";

  // Handle zero total case
  if (total === 0) {
    return (
      <div>
        <div className={cn("mb-1 flex items-center justify-between", textSize)}>
          <span className="text-zinc-600 dark:text-zinc-400">{label}</span>
          <span className="text-zinc-400 dark:text-zinc-500">—</span>
        </div>
        <div className={cn(barHeight, "overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800")} />
      </div>
    );
  }

  return (
    <div>
      {/* Header: Label + Used/Total */}
      <div className={cn("mb-1 flex items-center justify-between", textSize)}>
        <div>
          <span className="text-zinc-600 dark:text-zinc-400">{label}</span>
          <span className="ml-2 tabular-nums text-zinc-900 dark:text-zinc-100">
            {formatCompact(used)}/{formatCompact(total)}
          </span>
          {unit && (
            <span className="ml-0.5 text-xs text-zinc-400 dark:text-zinc-500">
              {unit}
            </span>
          )}
        </div>
      </div>

      {/* Bar */}
      <div
        className={cn(
          barHeight,
          "overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800"
        )}
      >
        <div
          className={cn("h-full rounded-full transition-all", barColor)}
          style={{ width: `${Math.min(percent, 100)}%` }}
        />
      </div>

      {/* Free label */}
      {showFree && (
        <div className="mt-1 flex justify-end text-xs tabular-nums text-zinc-500 dark:text-zinc-400">
          {formatCompact(free)}
          {unit && ` ${unit}`} free
        </div>
      )}
    </div>
  );
}
