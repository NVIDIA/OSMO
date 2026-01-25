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
 * Invalid Zone Overlay Component
 *
 * Renders striped overlays over zones beyond entity boundaries (regions where
 * logs cannot exist - before workflow/group/task started or after completion).
 *
 * This provides clear visual feedback that panning beyond these zones is blocked.
 *
 * ## Visual Design
 *
 * - Diagonal stripe pattern (45deg) using CSS repeating-linear-gradient
 * - Light mode: subtle dark stripes (opacity 0.04 / 0.10)
 * - Dark mode: subtle light stripes (opacity 0.03 / 0.08)
 * - Z-index: auto (rendered before TimelineOverlay, so appears underneath)
 * - Always visible when invalid zones are in viewport
 */

"use client";

import { cn } from "@/lib/utils";

// =============================================================================
// Types
// =============================================================================

export interface InvalidZoneOverlayProps {
  /** Position from left edge as percentage (0-100) */
  leftPercent: number;
  /** Width as percentage (0-100) */
  widthPercent: number;
  /** Side: left (before start) or right (after end) */
  side: "left" | "right";
  /** Additional CSS classes */
  className?: string;
}

// =============================================================================
// Component
// =============================================================================

/**
 * Striped overlay for invalid zones beyond entity boundaries.
 */
export function InvalidZoneOverlay({ leftPercent, widthPercent, side, className }: InvalidZoneOverlayProps) {
  if (widthPercent <= 0) return null;

  return (
    <div
      className={cn(
        "pointer-events-none absolute top-0 h-full",
        "transition-all duration-200 ease-out",
        // Striped pattern using CSS background
        "[background:repeating-linear-gradient(45deg,rgb(0_0_0/0.04),rgb(0_0_0/0.04)_8px,rgb(0_0_0/0.10)_8px,rgb(0_0_0/0.10)_16px)]",
        "dark:[background:repeating-linear-gradient(45deg,rgb(255_255_255/0.03),rgb(255_255_255/0.03)_8px,rgb(255_255_255/0.08)_8px,rgb(255_255_255/0.08)_16px)]",
        className,
      )}
      style={{
        left: `${leftPercent}%`,
        width: `${widthPercent}%`,
      }}
      aria-hidden="true"
      data-invalid-zone-side={side}
      title={`Invalid zone (${side}): logs cannot exist here`}
    />
  );
}
