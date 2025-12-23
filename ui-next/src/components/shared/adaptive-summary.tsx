/**
 * Copyright (c) 2025, NVIDIA CORPORATION. All rights reserved.
 *
 * NVIDIA CORPORATION and its licensors retain all intellectual property
 * and proprietary rights in and to this software, related documentation
 * and any modifications thereto. Any use, reproduction, disclosure or
 * distribution of this software and related documentation without an express
 * license agreement from NVIDIA CORPORATION is strictly prohibited.
 */

"use client";

import { useMemo } from "react";
import { Zap, Cpu, MemoryStick, HardDrive } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Resource } from "@/lib/api/adapter";
import type { ResourceDisplayMode } from "@/headless";

interface AdaptiveSummaryProps {
  /** Array of resources to aggregate */
  resources: Resource[];
  /** Display mode: "free" shows available, "used" shows utilization */
  displayMode?: ResourceDisplayMode;
  /** Show loading skeleton */
  isLoading?: boolean;
}

/**
 * Adaptive summary cards using CSS container queries.
 * 
 * Automatically transitions between layouts based on available width:
 * - Wide (≥500px): 4 column grid with icon + label header, value below
 * - Narrow (<500px): 2 column grid with icon + value inline
 * 
 * Uses GPU-accelerated CSS transitions for smooth layout changes.
 */
export function AdaptiveSummary({
  resources,
  displayMode = "free",
  isLoading = false,
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
      { gpu: { used: 0, total: 0 }, cpu: { used: 0, total: 0 }, memory: { used: 0, total: 0 }, storage: { used: 0, total: 0 } }
    );
  }, [resources]);

  const format = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));
  const getValue = (m: { used: number; total: number }) => (displayMode === "free" ? m.total - m.used : m.used);

  if (isLoading) {
    return <div className="h-12 animate-pulse rounded-lg bg-zinc-100 dark:bg-zinc-800" />;
  }

  const metrics = [
    { Icon: Zap, label: "GPU", value: totals.gpu, color: "text-amber-500" },
    { Icon: Cpu, label: "CPU", value: totals.cpu, color: "text-blue-500" },
    { Icon: MemoryStick, label: "Memory", value: totals.memory, unit: "GB", color: "text-purple-500" },
    { Icon: HardDrive, label: "Storage", value: totals.storage, unit: "GB", color: "text-emerald-500" },
  ];

  return (
    // Container query wrapper - @container queries check this element's width
    <div className="@container">
      {/* Grid: 2 col (narrow) → 4 col (wide) */}
      <div className="grid grid-cols-2 gap-2 @[500px]:gap-3 @[500px]:grid-cols-4 transition-all duration-200">
        {metrics.map((item, i) => (
          <div
            key={i}
            className="group rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950 transition-all duration-200 p-2 @[500px]:p-3"
          >
            {/* Compact mode (<500px): single row with icon + value */}
            {/* Wide mode (≥500px): stacked with header row */}
            <div className="flex items-center gap-2 @[500px]:flex-col @[500px]:items-start @[500px]:gap-0 transition-all duration-200">
              {/* Icon + Label (label only visible in wide mode) */}
              <div className="flex items-center gap-2 @[500px]:mb-1">
                <item.Icon className={cn("h-4 w-4 shrink-0", item.color)} />
                <span className="hidden @[500px]:inline text-xs font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                  {item.label}
                </span>
              </div>

              {/* Value */}
              <div className="flex items-baseline gap-1 flex-wrap">
                <span className="text-xl font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">
                  {format(getValue(item.value))}
                </span>
                {displayMode === "used" && (
                  <span className="text-sm text-zinc-400 dark:text-zinc-500">
                    / {format(item.value.total)}
                  </span>
                )}
                {item.unit && (
                  <span className="text-xs text-zinc-400 dark:text-zinc-500 ml-0.5">
                    {item.unit}
                  </span>
                )}
                <span className="text-xs text-zinc-400 dark:text-zinc-500 ml-1">
                  {displayMode === "free" ? "free" : "used"}
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
