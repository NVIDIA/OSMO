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
import { type LucideIcon, Server, Zap } from "lucide-react";
import { ProgressBar } from "@/components/progress-bar";
import { Skeleton } from "@/components/shadcn/skeleton";
import { formatCompact } from "@/lib/utils";
import type { Quota } from "@/lib/api/adapter/types";

interface PoolGpuSummaryProps {
  summary: Quota;
  isLoading?: boolean;
}

function getUtilizationColor(percent: number): string {
  if (percent < 65) return "bg-emerald-500";
  if (percent < 85) return "bg-amber-500";
  return "bg-red-500";
}

interface PoolGpuSummaryCardProps {
  label: string;
  icon: LucideIcon;
  used: number;
  free: number;
  total: number;
}

const PoolGpuSummaryCard = memo(function PoolGpuSummaryCard({
  label,
  icon: Icon,
  used,
  free,
  total,
}: PoolGpuSummaryCardProps) {
  const percent = total > 0 ? (used / total) * 100 : 0;

  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-950">
      <div className="flex items-center gap-1.5">
        <Icon className="h-3.5 w-3.5 shrink-0 text-amber-500" />
        <span className="text-xs font-medium tracking-wider text-zinc-500 uppercase dark:text-zinc-400">{label}</span>
        <span className="ml-auto text-sm font-semibold text-zinc-600 tabular-nums dark:text-zinc-400">
          {Math.round(percent)}%
        </span>
      </div>

      <ProgressBar
        value={used}
        max={total}
        size="sm"
        colorClass={getUtilizationColor(percent)}
        className="mt-3"
      />

      <div className="mt-3 flex items-baseline justify-between tabular-nums">
        <div className="flex items-baseline gap-1">
          <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{formatCompact(used)}</span>
          <span className="text-xs text-zinc-400 dark:text-zinc-500">/ {formatCompact(total)}</span>
          <span className="text-xs font-medium text-zinc-400 dark:text-zinc-500">used</span>
        </div>
        <div className="flex items-baseline gap-1">
          <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{formatCompact(free)}</span>
          <span className="text-xs font-medium text-zinc-400 dark:text-zinc-500">free</span>
        </div>
      </div>
    </div>
  );
});

export const PoolGpuSummary = memo(function PoolGpuSummary({ summary, isLoading = false }: PoolGpuSummaryProps) {
  return (
    <div className="contain-layout-style @container">
      <div className="grid grid-cols-2 gap-2 @[500px]:gap-3">
        {isLoading ? (
          <>
            <Skeleton className="h-28" />
            <Skeleton className="h-28" />
          </>
        ) : (
          <>
            <PoolGpuSummaryCard
              label="GPU Quota"
              icon={Zap}
              used={summary.used}
              free={summary.free}
              total={summary.limit}
            />
            <PoolGpuSummaryCard
              label="GPU Capacity"
              icon={Server}
              used={summary.totalUsage}
              free={summary.totalFree}
              total={summary.totalCapacity}
            />
          </>
        )}
      </div>
    </div>
  );
});
