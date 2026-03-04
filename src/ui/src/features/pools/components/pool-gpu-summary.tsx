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

"use client";

import { memo } from "react";
import { Zap } from "lucide-react";
import { formatCompact } from "@/lib/utils";
import type { Quota } from "@/lib/api/adapter/types";
import type { DisplayMode } from "@/stores/shared-preferences-store";

interface PoolGpuSummaryProps {
  summary: Quota;
  displayMode?: DisplayMode;
  isLoading?: boolean;
}

export const PoolGpuSummary = memo(function PoolGpuSummary({
  summary,
  displayMode = "free",
  isLoading = false,
}: PoolGpuSummaryProps) {
  if (isLoading) {
    return (
      <div className="contain-layout-style @container">
        <div className="grid grid-cols-2 gap-2 @[500px]:gap-3">
          <div className="h-12 animate-pulse rounded-lg bg-zinc-100 dark:bg-zinc-800" />
          <div className="h-12 animate-pulse rounded-lg bg-zinc-100 dark:bg-zinc-800" />
        </div>
      </div>
    );
  }

  const metrics = [
    {
      label: "GPU Quota",
      freeValue: summary.free,
      usedValue: summary.used,
      totalValue: summary.limit,
    },
    {
      label: "GPU Capacity",
      freeValue: summary.totalFree,
      usedValue: summary.totalUsage,
      totalValue: summary.totalCapacity,
    },
  ];

  return (
    <div className="contain-layout-style @container">
      <div className="grid grid-cols-2 gap-2 @[500px]:gap-3">
        {metrics.map((metric) => {
          const primary = displayMode === "free" ? metric.freeValue : metric.usedValue;

          return (
            <div
              key={metric.label}
              className="rounded-lg border border-zinc-200 bg-white p-2 transition-all duration-200 @[500px]:p-3 dark:border-zinc-800 dark:bg-zinc-950"
            >
              <div className="flex items-center gap-2 @[500px]:flex-col @[500px]:items-start @[500px]:gap-0">
                <div className="flex items-center gap-2 @[500px]:mb-1">
                  <Zap className="h-4 w-4 shrink-0 text-amber-500" />
                  <span className="hidden text-xs font-medium tracking-wider text-zinc-500 uppercase @[300px]:inline dark:text-zinc-400">
                    {metric.label}
                  </span>
                </div>

                <div className="flex flex-wrap items-baseline gap-1">
                  <span className="text-xl font-semibold text-zinc-900 tabular-nums dark:text-zinc-100">
                    {formatCompact(primary)}
                  </span>
                  {displayMode === "used" && (
                    <span className="text-sm text-zinc-400 dark:text-zinc-500">
                      / {formatCompact(metric.totalValue)}
                    </span>
                  )}
                  <span className="ml-1 text-xs text-zinc-400 dark:text-zinc-500">{displayMode}</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
});
