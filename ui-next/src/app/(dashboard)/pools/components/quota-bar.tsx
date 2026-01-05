/**
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION. All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * SPDX-License-Identifier: Apache-2.0
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
export const QuotaBar = memo(function QuotaBar({ used, limit, free, isLoading }: QuotaBarProps) {
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
            <span className="font-medium text-emerald-600 dark:text-emerald-400">{free} available</span> for HIGH/NORMAL
            priority workflows
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
