// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION. All rights reserved.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
//
// SPDX-License-Identifier: Apache-2.0

"use client";

import { memo } from "react";
import { cn } from "@/lib/utils";
import { ProgressBar } from "@/components/progress-bar";

export interface InlineProgressProps {
  /** Current usage value */
  used: number;
  /** Total/maximum value */
  total: number;
  /** Compact mode: hide progress bar, show only text */
  compact?: boolean;
  /** Width of the progress bar */
  barWidth?: string;
  /** Additional content to render after the label (e.g., icons) */
  children?: React.ReactNode;
  /** Additional className for the container */
  className?: string;
}

// =============================================================================
// Component
// =============================================================================

/**
 * InlineProgress - Horizontal progress display for table cells.
 *
 * Renders a progress bar with a "{used}/{total}" fraction label.
 * Suitable for table cells showing utilization.
 *
 * @example
 * ```tsx
 * <InlineProgress used={6} total={8} />
 * <InlineProgress used={6} total={8} compact />
 * ```
 */
export const InlineProgress = memo(function InlineProgress({
  used,
  total,
  compact = false,
  barWidth = "w-16",
  children,
  className,
}: InlineProgressProps) {
  const label = `${used}/${total}`;

  if (compact) {
    return (
      <div className={cn("flex items-center gap-1.5", className)}>
        <span className="text-xs text-zinc-700 tabular-nums dark:text-zinc-300">{label}</span>
        {children}
      </div>
    );
  }

  const maxBarWidth = barWidth.replace(/^w-/, "max-w-");

  return (
    <div className={cn("flex min-w-0 flex-1 items-center gap-2", className)}>
      <div className={cn(maxBarWidth, "min-w-6 shrink grow basis-0")}>
        <ProgressBar
          value={used}
          max={total}
          size="md"
          thresholdColors
        />
      </div>
      <span className="text-xs whitespace-nowrap text-zinc-600 tabular-nums dark:text-zinc-400">{label}</span>
      {children}
    </div>
  );
});
