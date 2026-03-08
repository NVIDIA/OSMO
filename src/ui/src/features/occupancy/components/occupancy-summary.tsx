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
import { Cpu, HardDrive, MemoryStick, Zap } from "lucide-react";
import { Skeleton } from "@/components/shadcn/skeleton";
import { formatCompact } from "@/lib/utils";
import type { OccupancyTotals } from "@/lib/api/adapter/occupancy";

// =============================================================================
// Types
// =============================================================================

interface OccupancySummaryProps {
  totals: OccupancyTotals;
  isLoading?: boolean;
}

interface KpiCardProps {
  label: string;
  value: number;
  Icon: React.ElementType;
  colorClass: string;
}

// =============================================================================
// Card
// =============================================================================

const KpiCard = memo(function KpiCard({ label, value, Icon, colorClass }: KpiCardProps) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-950">
      <div className="flex items-center gap-1.5">
        <span className={colorClass}>
          <Icon className="h-3.5 w-3.5" />
        </span>
        <span className="text-xs font-medium tracking-wider text-zinc-500 uppercase dark:text-zinc-400">{label}</span>
      </div>
      <div className="mt-2 tabular-nums">
        <span className="text-2xl font-semibold text-zinc-900 dark:text-zinc-100">{formatCompact(value)}</span>
      </div>
    </div>
  );
});

// =============================================================================
// Summary Component
// =============================================================================

export const OccupancySummary = memo(function OccupancySummary({ totals, isLoading = false }: OccupancySummaryProps) {
  if (isLoading) {
    return (
      <div className="grid grid-cols-4 gap-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton
            key={i}
            className="h-20"
          />
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-4 gap-2">
      <KpiCard
        label="GPU"
        value={totals.gpu}
        Icon={Zap}
        colorClass="text-amber-500"
      />
      <KpiCard
        label="CPU"
        value={totals.cpu}
        Icon={Cpu}
        colorClass="text-blue-500"
      />
      <KpiCard
        label="Memory"
        value={totals.memory}
        Icon={MemoryStick}
        colorClass="text-purple-500"
      />
      <KpiCard
        label="Storage"
        value={totals.storage}
        Icon={HardDrive}
        colorClass="text-zinc-500"
      />
    </div>
  );
});
