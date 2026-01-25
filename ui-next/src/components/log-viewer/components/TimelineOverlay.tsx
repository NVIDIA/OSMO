//SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION. All rights reserved.

//Licensed under the Apache License, Version 2.0 (the "License");
//you may not use this file except in compliance with the License.
//You may obtain a copy of the License at

//http://www.apache.org/licenses/LICENSE-2.0

//Unless required by applicable law or agreed to in writing, software
//distributed under the License is distributed on an "AS IS" BASIS,
//WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//See the License for the specific language governing permissions and
//limitations under the License.

//SPDX-License-Identifier: Apache-2.0

/**
 * Timeline Overlay Component
 *
 * Renders semi-transparent overlays over padding zones (regions outside
 * the effective time range). This provides visual feedback that those
 * areas contain unqueried data.
 *
 * ## Visual Design
 *
 * - Light mode: `rgb(0 0 0 / 0.1)` - subtle gray overlay
 * - Dark mode: `rgb(255 255 255 / 0.05)` - subtle white overlay
 * - Z-index: 1 (above histogram bars, below draggers)
 */

"use client";

import { cn } from "@/lib/utils";

// =============================================================================
// Types
// =============================================================================

export interface TimelineOverlayProps {
  /** Position from left edge as percentage (0-100) */
  leftPercent: number;
  /** Width as percentage (0-100) */
  widthPercent: number;
  /** Side: left or right padding zone */
  side: "left" | "right";
  /** Additional CSS classes */
  className?: string;
}

// =============================================================================
// Component
// =============================================================================

/**
 * Semi-transparent overlay for padding zones.
 */
export function TimelineOverlay({ leftPercent, widthPercent, side, className }: TimelineOverlayProps) {
  if (widthPercent <= 0) return null;

  return (
    <div
      className={cn(
        "pointer-events-none absolute top-0 h-full",
        "bg-black/10 dark:bg-white/5",
        "transition-all duration-200 ease-out",
        className,
      )}
      style={{
        left: `${leftPercent}%`,
        width: `${widthPercent}%`,
      }}
      aria-hidden="true"
      data-overlay-side={side}
    />
  );
}
