/**
 * Copyright (c) 2025-2026, NVIDIA CORPORATION. All rights reserved.
 *
 * NVIDIA CORPORATION and its licensors retain all intellectual property
 * and proprietary rights in and to this software, related documentation
 * and any modifications thereto. Any use, reproduction, disclosure or
 * distribution of this software and related documentation without an express
 * license agreement from NVIDIA CORPORATION is strictly prohibited.
 */

import { memo } from "react";
import { cn } from "@/lib/utils";
import { card, skeleton, text } from "@/lib/styles";
import { ProgressBar } from "@/components/progress-bar";

// =============================================================================
// Types
// =============================================================================

interface QuotaBarProps {
  /** Amount of quota used */
  used: number;
  /** Total quota limit */
  limit: number;
  /** Amount of quota free (should equal limit - used) */
  free: number;
  /** Loading state */
  isLoading?: boolean;
}

// =============================================================================
// Component
// =============================================================================

/**
 * QuotaBar - Card-wrapped quota display with contextual messaging.
 *
 * Pool-specific component that shows GPU quota in a prominent card format
 * with workflow priority guidance.
 *
 * Composes from ProgressBar primitive.
 *
 * @example
 * ```tsx
 * <QuotaBar used={6} limit={8} free={2} />
 * <QuotaBar used={0} limit={8} free={8} isLoading />
 * ```
 */
export const QuotaBar = memo(function QuotaBar({
  used,
  limit,
  free,
  isLoading,
}: QuotaBarProps) {
  if (isLoading) {
    return (
      <div className={cn(card.base, "p-4")}>
        <div className={cn(skeleton.base, skeleton.md, "w-24")} />
        <div className={cn(skeleton.base, "mt-3 h-3 w-full rounded-full")} />
        <div className={cn(skeleton.base, skeleton.sm, "mt-2 w-48")} />
      </div>
    );
  }

  return (
    <div className={cn(card.base, "p-4")}>
      {/* Header: Label + Used/Limit */}
      <div className="flex items-baseline justify-between">
        <span className={text.muted}>GPU Quota</span>
        <span className="text-lg font-semibold tabular-nums">
          {used} <span className="text-zinc-400">/</span> {limit}
          <span className="ml-1 text-sm font-normal text-zinc-500">GPUs</span>
        </span>
      </div>

      {/* Progress bar */}
      <div className="mt-3">
        <ProgressBar
          value={used}
          max={limit}
          size="md"
          thresholdColors
          trackClassName="h-3"
        aria-label={`GPU quota: ${used} of ${limit} GPUs used, ${free} available`}
        />
      </div>

      {/* Contextual message */}
      <p className={cn("mt-2", text.muted)}>
        {free > 0 ? (
          <>
            <span className="font-medium text-emerald-600 dark:text-emerald-400">
              {free} available
            </span>{" "}
            for HIGH/NORMAL priority workflows
          </>
        ) : (
          <span className="text-amber-600 dark:text-amber-400">
            No quota available — LOW priority workflows may still run
          </span>
        )}
      </p>
    </div>
  );
});
