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

import { memo, type ReactNode } from "react";
import { cn, formatCompact, formatBytesPair } from "@/lib/utils";
import { ProgressBar } from "@/components/progress-bar";

// =============================================================================
// Types
// =============================================================================

export interface CapacityBarProps {
  /** Label for the capacity type - can be a string or custom ReactNode for badges/icons */
  label: ReactNode;
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
  /** Optional content to render below the bar (e.g., related info, shared pools) */
  children?: ReactNode;
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
 * Composes from ProgressBar primitive. Supports children for
 * additional related content (e.g., shared pools info).
 *
 * @example
 * ```tsx
 * <CapacityBar label="GPU" used={6} total={8} />
 * <CapacityBar label="Memory" used={256} total={512} isBytes />
 *
 * // With children for related content
 * <CapacityBar label="GPU Capacity" used={6} total={8}>
 *   <SharedPoolsInfo pools={sharedPools} />
 * </CapacityBar>
 * ```
 */
export const CapacityBar = memo(function CapacityBar({
  label,
  used,
  total,
  isBytes = false,
  size = "md",
  showFree = true,
  children,
}: CapacityBarProps) {
  const barSize = size === "sm" ? "sm" : "md";
  const textSize = size === "sm" ? "text-xs" : "text-sm";

  // Handle zero total case
  if (total === 0) {
    return (
      <div>
        <div className={cn("mb-2 text-zinc-600 dark:text-zinc-400", textSize)}>{label}</div>
        <ProgressBar
          value={0}
          max={1}
          size={barSize}
        />
        <div className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">—</div>
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
      {/* Header: Label */}
      <div className={cn("mb-2 text-zinc-600 dark:text-zinc-400", textSize)}>{label}</div>

      {/* Progress bar */}
      <ProgressBar
        value={used}
        max={total}
        size={barSize}
        aria-label={ariaLabel}
      />

      {/* Footer: Used (left) / Free (right) - matches bar segment positions */}
      {showFree && (
        <div className="mt-2 flex items-center justify-between text-sm text-zinc-600 tabular-nums dark:text-zinc-400">
          <span>
            {usedStr}/{totalStr}
            {unit && <span className="ml-0.5">{unit}</span>} used
          </span>
          <span>{freeDisplay} free</span>
        </div>
      )}

      {/* Optional additional content */}
      {children && <div className="mt-3">{children}</div>}
    </div>
  );
});
