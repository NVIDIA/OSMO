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
import { Card, CardContent } from "@/components/shadcn/card";
import { Skeleton } from "@/components/shadcn/skeleton";
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
      <Card className="gap-3 py-4">
        <CardContent className="space-y-3">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-3 w-full rounded-full" />
          <Skeleton className="h-3 w-48" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="gap-3 py-4">
      <CardContent className="space-y-3">
        {/* Header: Label + Used/Limit */}
        <div className="flex items-baseline justify-between">
          <span className="text-sm text-muted-foreground">GPU Quota</span>
          <span className="text-lg font-semibold tabular-nums">
            {used} <span className="text-muted-foreground">/</span> {limit}
            <span className="ml-1 text-sm font-normal text-muted-foreground">GPUs</span>
          </span>
        </div>

        {/* Progress bar */}
        <ProgressBar
          value={used}
          max={limit}
          size="md"
          thresholdColors
          trackClassName="h-3"
          aria-label={`GPU quota: ${used} of ${limit} GPUs used, ${free} available`}
        />

        {/* Contextual message */}
        <p className="text-sm text-muted-foreground">
          {free > 0 ? (
            <>
              <span className="font-medium text-nvidia dark:text-nvidia-light">{free} available</span> for HIGH/NORMAL
              priority workflows
            </>
          ) : (
            <span className="font-medium text-foreground">
              No quota available — LOW priority workflows may still run
            </span>
          )}
        </p>
      </CardContent>
    </Card>
  );
});
