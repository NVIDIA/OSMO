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

"use client";

import { useMemo, memo } from "react";
import { Zap, Cpu, MemoryStick, HardDrive } from "lucide-react";
import { cn, formatCompact, formatBytes, formatBytesPair } from "@/lib/utils";
import type { Resource } from "@/lib/api/adapter";
import type { DisplayMode } from "@/stores";

interface AdaptiveSummaryProps {
  /** Array of resources to aggregate */
  resources: Resource[];
  /** Display mode: "free" shows available, "used" shows utilization */
  displayMode?: DisplayMode;
  /** Show loading skeleton */
  isLoading?: boolean;
  /** Force compact layout regardless of container width */
  forceCompact?: boolean;
}

/**
 * Adaptive summary cards using CSS container queries.
 *
 * Full mode (forceCompact=false):
 * - Wide (≥500px): 4 column grid with icon + label header, value below
 * - Narrow (<500px): 2 column grid with icon + value inline
 *
 * Compact mode (forceCompact=true):
 * - Always 4 column inline layout with smaller text
 * - Progressively shows more detail as width increases:
 *   - ≥600px: Shows denominator (e.g., "/ 100")
 *   - ≥700px: Shows "free"/"used" label, larger text
 *   - ≥800px: Shows metric labels (GPU, CPU, etc.)
 *
 * Uses GPU-accelerated CSS transitions for smooth layout changes.
 * Memoized to prevent unnecessary re-renders when props haven't changed.
 */
export const AdaptiveSummary = memo(function AdaptiveSummary({
  resources,
  displayMode = "free",
  isLoading = false,
  forceCompact = false,
}: AdaptiveSummaryProps) {
  // Calculate totals
  const totals = useMemo(() => {
    return resources.reduce(
      (acc, r) => ({
        gpu: { used: acc.gpu.used + r.gpu.used, total: acc.gpu.total + r.gpu.total },
        cpu: { used: acc.cpu.used + r.cpu.used, total: acc.cpu.total + r.cpu.total },
        memory: { used: acc.memory.used + r.memory.used, total: acc.memory.total + r.memory.total },
        storage: { used: acc.storage.used + r.storage.used, total: acc.storage.total + r.storage.total },
      }),
      {
        gpu: { used: 0, total: 0 },
        cpu: { used: 0, total: 0 },
        memory: { used: 0, total: 0 },
        storage: { used: 0, total: 0 },
      },
    );
  }, [resources]);

  if (isLoading) {
    return <div className="h-12 animate-pulse rounded-lg bg-zinc-100 dark:bg-zinc-800" />;
  }

  // Format helper for each metric type
  const formatMetric = (
    m: { used: number; total: number },
    isBytes: boolean,
  ): { freeValue: string; usedValue: string; totalValue: string; unit: string } => {
    if (isBytes) {
      const free = m.total - m.used;
      const freeFormatted = formatBytes(free);
      const pair = formatBytesPair(m.used, m.total);
      return {
        freeValue: freeFormatted.value,
        usedValue: pair.used,
        totalValue: pair.total,
        unit: displayMode === "free" ? freeFormatted.unit : pair.unit,
      };
    }
    // Non-bytes: use compact formatting
    const free = m.total - m.used;
    return {
      freeValue: formatCompact(free),
      usedValue: formatCompact(m.used),
      totalValue: formatCompact(m.total),
      unit: "",
    };
  };

  const metrics = [
    { Icon: Zap, label: "GPU", value: totals.gpu, isBytes: false, color: "text-amber-500" },
    { Icon: Cpu, label: "CPU", value: totals.cpu, isBytes: false, color: "text-blue-500" },
    { Icon: MemoryStick, label: "Memory", value: totals.memory, isBytes: true, color: "text-purple-500" },
    { Icon: HardDrive, label: "Storage", value: totals.storage, isBytes: true, color: "text-emerald-500" },
  ];

  return (
    // Container query wrapper - @container queries check this element's width
    // Compact mode still uses container queries to progressively show more details
    // Containment isolates layout/style calculations for better perf
    <div className="contain-layout-style @container">
      {/* Grid: 2 col (narrow) → 4 col (wide or compact) */}
      <div
        className={cn(
          "grid gap-2 transition-all duration-200",
          forceCompact
            ? "grid-cols-4" // Forced compact: always 4 col inline layout
            : "grid-cols-2 @[500px]:grid-cols-4 @[500px]:gap-3", // Responsive
        )}
      >
        {metrics.map((item, i) => {
          const formatted = formatMetric(item.value, item.isBytes);
          const displayValue = displayMode === "free" ? formatted.freeValue : formatted.usedValue;

          return (
            <div
              key={i}
              className={cn(
                "group rounded-lg border border-zinc-200 bg-white transition-all duration-200 dark:border-zinc-800 dark:bg-zinc-950",
                forceCompact ? "p-2 @[700px]:p-2.5" : "p-2 @[500px]:p-3",
              )}
            >
              {/* Compact mode: single row with icon + value */}
              {/* Wide mode: stacked with header row */}
              <div
                className={cn(
                  "flex items-center gap-2 transition-all duration-200",
                  !forceCompact && "@[500px]:flex-col @[500px]:items-start @[500px]:gap-0",
                )}
              >
                {/* Icon + Label */}
                <div className={cn("flex items-center gap-2", !forceCompact && "@[500px]:mb-1")}>
                  <item.Icon className={cn("h-4 w-4 shrink-0", item.color)} />
                  {/* In compact mode, show label at wider widths; in full mode, show at @[500px] */}
                  {forceCompact ? (
                    <span className="hidden text-xs font-medium tracking-wider text-zinc-500 uppercase @[800px]:inline dark:text-zinc-400">
                      {item.label}
                    </span>
                  ) : (
                    <span className="hidden text-xs font-medium tracking-wider text-zinc-500 uppercase @[500px]:inline dark:text-zinc-400">
                      {item.label}
                    </span>
                  )}
                </div>

                {/* Value with progressive detail based on available space */}
                <div className="flex flex-wrap items-baseline gap-1">
                  <span
                    className={cn(
                      "font-semibold text-zinc-900 tabular-nums dark:text-zinc-100",
                      forceCompact ? "text-sm @[700px]:text-base" : "text-xl",
                    )}
                  >
                    {displayValue}
                  </span>
                  {/* Denominator: always show in full mode, show at @[600px] in compact */}
                  {displayMode === "used" && (
                    <span
                      className={cn(
                        "text-sm text-zinc-400 dark:text-zinc-500",
                        forceCompact && "hidden @[600px]:inline",
                      )}
                    >
                      / {formatted.totalValue}
                    </span>
                  )}
                  {/* Unit */}
                  {formatted.unit && (
                    <span className="ml-0.5 text-xs text-zinc-400 dark:text-zinc-500">{formatted.unit}</span>
                  )}
                  {/* "free"/"used" label: always show in full mode, show at @[700px] in compact */}
                  <span
                    className={cn(
                      "ml-1 text-xs text-zinc-400 dark:text-zinc-500",
                      forceCompact && "hidden @[700px]:inline",
                    )}
                  >
                    {displayMode === "free" ? "free" : "used"}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
});
