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
import { getProgressColor } from "@/lib/styles";

// =============================================================================
// Types
// =============================================================================

export interface ProgressBarProps {
  /** Current value */
  value: number;
  /** Maximum value */
  max: number;
  /** Height variant */
  size?: "xs" | "sm" | "md";
  /** Use threshold colors (green → amber → red) based on percentage */
  thresholdColors?: boolean;
  /** Custom color class (overrides thresholdColors) */
  colorClass?: string;
  /** Additional class for the track (background) */
  trackClassName?: string;
  /** Additional class for the fill (indicator) */
  fillClassName?: string;
  /** Accessible label */
  "aria-label"?: string;
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
// Component
// =============================================================================

/**
 * ProgressBar - Core progress bar primitive with threshold colors.
 *
 * This is the lowest-level progress component. It renders just the bar
 * with optional threshold-based coloring (green → amber → red).
 *
 * Higher-level components like CapacityBar and InlineProgress compose
 * from this primitive.
 *
 * Uses GPU-accelerated scaleX transform for smooth animations.
 *
 * @example
 * ```tsx
 * // Basic usage
 * <ProgressBar value={6} max={8} />
 *
 * // With threshold colors
 * <ProgressBar value={95} max={100} thresholdColors />
 *
 * // Custom styling
 * <ProgressBar value={50} max={100} colorClass="bg-blue-500" size="sm" />
 * ```
 */
export const ProgressBar = memo(function ProgressBar({
  value,
  max,
  size = "md",
  thresholdColors = true,
  colorClass,
  trackClassName,
  fillClassName,
  "aria-label": ariaLabel,
}: ProgressBarProps) {
  const percent = max > 0 ? (value / max) * 100 : 0;
  const clampedPercent = Math.min(percent, 100);

  // Determine fill color
  const fillColor = colorClass ?? (thresholdColors ? getProgressColor(percent) : "bg-primary");

  return (
    <div
      role="progressbar"
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-label={ariaLabel}
      className={cn(
        SIZE_CLASSES[size],
        "contain-layout-paint overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800",
        trackClassName,
      )}
    >
      <div
        className={cn(
          "h-full w-full origin-left rounded-full transition-transform duration-300 ease-out",
          fillColor,
          fillClassName,
        )}
        style={{ transform: `scaleX(${clampedPercent / 100})` }}
      />
    </div>
  );
});
