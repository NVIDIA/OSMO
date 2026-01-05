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
import type { DisplayMode } from "@/stores";
import { ProgressBar } from "./progress-bar";

// Re-export for consumers that import from here
export type { DisplayMode };

export interface InlineProgressProps {
  /** Current usage value */
  used: number;
  /** Total/maximum value */
  total: number;
  /** Display mode: show "used/total" or "free" */
  displayMode?: DisplayMode;
  /** Compact mode: hide progress bar, show only text */
  compact?: boolean;
  /** Width of the progress bar */
  barWidth?: string;
  /** Label for free display (e.g., "free", "idle", "available") */
  freeLabel?: string;
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
 * Renders a progress bar with value label in a horizontal layout,
 * suitable for table cells and inline contexts.
 *
 * Composes from ProgressBar primitive.
 *
 * @example
 * ```tsx
 * // Basic usage
 * <InlineProgress used={6} total={8} />
 *
 * // Free display mode
 * <InlineProgress used={6} total={8} displayMode="free" freeLabel="idle" />
 *
 * // Compact mode (no bar)
 * <InlineProgress used={6} total={8} compact />
 *
 * // With trailing content (e.g., icon)
 * <InlineProgress used={6} total={8}>
 *   <ShareIcon />
 * </InlineProgress>
 * ```
 */
export const InlineProgress = memo(function InlineProgress({
  used,
  total,
  displayMode = "used",
  compact = false,
  barWidth = "w-16",
  freeLabel = "free",
  children,
  className,
}: InlineProgressProps) {
  const free = total - used;

  // Format display label based on mode
  const displayLabel = displayMode === "used" ? `${used}/${total}` : `${free} ${freeLabel}`;

  if (compact) {
    return (
      <div className={cn("flex items-center gap-1.5", className)}>
        <span className="text-xs text-zinc-700 tabular-nums dark:text-zinc-300">{displayLabel}</span>
        {children}
      </div>
    );
  }

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <div className={cn(barWidth, "shrink-0")}>
        <ProgressBar
          value={used}
          max={total}
          size="md"
          thresholdColors
        />
      </div>
      <span className="text-xs whitespace-nowrap text-zinc-600 tabular-nums dark:text-zinc-400">{displayLabel}</span>
      {children}
    </div>
  );
});
