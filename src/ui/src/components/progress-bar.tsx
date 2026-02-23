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

import * as React from "react";
import * as ProgressPrimitive from "@radix-ui/react-progress";
import { cn } from "@/lib/utils";

// =============================================================================
// Types
// =============================================================================

export interface ProgressBarProps extends React.ComponentProps<typeof ProgressPrimitive.Root> {
  /** Current value */
  value: number;
  /** Maximum value */
  max?: number;
  /** Height variant */
  size?: "xs" | "sm" | "md";
  /** Use threshold colors (green → amber → red) based on percentage. Default: false (NVIDIA green) */
  thresholdColors?: boolean;
  /** Custom color class (overrides thresholdColors) */
  colorClass?: string;
  /** Additional class for the track (background) */
  trackClassName?: string;
  /** Additional class for the fill (indicator) */
  fillClassName?: string;
}

// =============================================================================
// Size mappings
// =============================================================================

const SIZE_CLASSES = {
  xs: "h-1",
  sm: "h-1.5",
  md: "h-2",
} as const;

// =============================================================================
// Color logic
// =============================================================================

/**
 * Get progress bar color based on percentage thresholds.
 * Uses NVIDIA brand green for normal, amber for warning, red for critical.
 */
function getProgressColor(percent: number): string {
  if (percent >= 90) return "bg-red-500";
  if (percent >= 75) return "bg-amber-500";
  return "bg-nvidia dark:bg-nvidia-light";
}

// =============================================================================
// Component
// =============================================================================

/**
 * ProgressBar - Extended progress bar with size variants.
 *
 * Extends shadcn/radix Progress primitive with:
 * - NVIDIA green default color
 * - Size variants (xs, sm, md)
 * - Proper max value support
 * - Optional threshold-based coloring (green → amber → red)
 *
 * Uses GPU-accelerated translateX transform for smooth animations.
 *
 * @example
 * ```tsx
 * // Basic usage (NVIDIA green)
 * <ProgressBar value={6} max={8} />
 *
 * // Custom styling
 * <ProgressBar value={50} max={100} colorClass="bg-blue-500" size="sm" />
 * ```
 */
export function ProgressBar({
  value,
  max = 100,
  size = "md",
  thresholdColors = false,
  colorClass,
  trackClassName,
  fillClassName,
  className,
  ...props
}: ProgressBarProps) {
  // Ensure max is always > 0 for Radix primitive (it requires positive values)
  const safeMax = max > 0 ? max : 100;
  const percent = max > 0 ? (value / max) * 100 : 0;
  const clampedPercent = Math.min(percent, 100);

  // Determine fill color - default to NVIDIA green
  const fillColor = colorClass ?? (thresholdColors ? getProgressColor(percent) : "bg-nvidia dark:bg-nvidia-light");

  return (
    <ProgressPrimitive.Root
      data-slot="progress"
      value={max > 0 ? Math.max(0, Math.min(value, max)) : 0}
      max={safeMax}
      className={cn(
        "relative w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800",
        SIZE_CLASSES[size],
        trackClassName,
        className,
      )}
      {...props}
    >
      <ProgressPrimitive.Indicator
        data-slot="progress-indicator"
        className={cn(
          "h-full w-full flex-1 rounded-full transition-transform duration-300 ease-out",
          fillColor,
          fillClassName,
        )}
        style={{ transform: `translateX(-${100 - clampedPercent}%)` }}
      />
    </ProgressPrimitive.Root>
  );
}
