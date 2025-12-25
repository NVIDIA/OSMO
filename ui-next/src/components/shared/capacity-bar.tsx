// Copyright (c) 2025, NVIDIA CORPORATION. All rights reserved.
//
// NVIDIA CORPORATION and its licensors retain all intellectual property
// and proprietary rights in and to this software, related documentation
// and any modifications thereto. Any use, reproduction, disclosure or
// distribution of this software and related documentation without an express
// license agreement from NVIDIA CORPORATION is strictly prohibited.

"use client";

import { memo } from "react";
import { cn, formatCompact, formatBytes, formatBytesPair } from "@/lib/utils";
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
  /** If true, values are in GiB and will be formatted with appropriate binary unit (Ki, Mi, Gi, Ti) */
  isBytes?: boolean;
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
 * Used across pool detail and resource views to show
 * resource utilization (GPU, CPU, Memory, Storage).
 *
 * Memoized to prevent unnecessary re-renders when values haven't changed.
 *
 * @example
 * ```tsx
 * <CapacityBar label="GPU" used={6} total={8} />
 * <CapacityBar label="Memory" used={256} total={512} unit="Gi" />
 * ```
 */
export const CapacityBar = memo(function CapacityBar({
  label,
  used,
  total,
  isBytes = false,
  size = "md",
  showFree = true,
}: CapacityBarProps) {
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

  // Format values - for bytes, use consistent units for used/total
  let usedStr: string;
  let totalStr: string;
  let unit: string;
  let freeDisplay: string;
  let ariaLabel: string;

  if (isBytes) {
    const pair = formatBytesPair(used, total);
    usedStr = pair.used;
    totalStr = pair.total;
    unit = pair.unit;
    freeDisplay = pair.freeDisplay;
    ariaLabel = `${label}: ${pair.used} ${pair.unit} of ${pair.total} ${pair.unit} used`;
  } else {
    const free = total - used;
    usedStr = formatCompact(used);
    totalStr = formatCompact(total);
    unit = "";
    freeDisplay = formatCompact(free);
    ariaLabel = `${label}: ${usedStr} of ${totalStr} used`;
  }

  return (
    <div>
      {/* Header: Label + Used/Total */}
      <div className={cn("mb-1 flex items-center justify-between", textSize)}>
        <div>
          <span className="text-zinc-600 dark:text-zinc-400">{label}</span>
          <span className="ml-2 tabular-nums text-zinc-900 dark:text-zinc-100">
            {usedStr}/{totalStr}
          </span>
          {unit && <span className="ml-0.5 text-xs text-zinc-400 dark:text-zinc-500">{unit}</span>}
        </div>
      </div>

      {/* Bar - WCAG 2.1 accessible progressbar */}
      <div
        role="progressbar"
        aria-valuenow={used}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-label={ariaLabel}
        className={cn(barHeight, "overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800")}
        style={{ contain: "layout paint" }}
      >
        <div
          className={cn("h-full rounded-full transition-[width] duration-300 ease-out", barColor)}
          style={{
            width: `${Math.min(percent, 100)}%`,
            // GPU acceleration for smooth width transitions
            transform: "translateZ(0)",
            willChange: "width",
          }}
        />
      </div>

      {/* Free label */}
      {showFree && (
        <div className="mt-1 flex justify-end text-xs tabular-nums text-zinc-500 dark:text-zinc-400">
          {freeDisplay} free
        </div>
      )}
    </div>
  );
});
