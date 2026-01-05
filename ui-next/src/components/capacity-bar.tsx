// Copyright (c) 2025-2026, NVIDIA CORPORATION. All rights reserved.
//
// NVIDIA CORPORATION and its licensors retain all intellectual property
// and proprietary rights in and to this software, related documentation
// and any modifications thereto. Any use, reproduction, disclosure or
// distribution of this software and related documentation without an express
// license agreement from NVIDIA CORPORATION is strictly prohibited.

"use client";

import { memo } from "react";
import { cn, formatCompact, formatBytesPair } from "@/lib/utils";
import { ProgressBar } from "./progress-bar";

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
 * CapacityBar - Vertical capacity/usage display for panels.
 *
 * Used across pool detail and resource views to show
 * resource utilization (GPU, CPU, Memory, Storage).
 *
 * Composes from ProgressBar primitive.
 *
 * @example
 * ```tsx
 * <CapacityBar label="GPU" used={6} total={8} />
 * <CapacityBar label="Memory" used={256} total={512} isBytes />
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
  const barSize = size === "sm" ? "sm" : "md";
  const textSize = size === "sm" ? "text-xs" : "text-sm";

  // Handle zero total case
  if (total === 0) {
    return (
      <div>
        <div className={cn("mb-1 flex items-center justify-between", textSize)}>
          <span className="text-zinc-600 dark:text-zinc-400">{label}</span>
          <span className="text-zinc-400 dark:text-zinc-500">—</span>
        </div>
        <ProgressBar
          value={0}
          max={1}
          size={barSize}
        />
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

      {/* Progress bar */}
      <ProgressBar
        value={used}
        max={total}
        size={barSize}
        thresholdColors
        aria-label={ariaLabel}
      />

      {/* Free label */}
      {showFree && (
        <div className="mt-1 flex justify-end text-xs tabular-nums text-zinc-500 dark:text-zinc-400">
          {freeDisplay} free
        </div>
      )}
    </div>
  );
});
