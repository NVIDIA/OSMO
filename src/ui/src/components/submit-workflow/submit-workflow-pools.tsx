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

/**
 * SubmitWorkflowPools - Section 2 of the config panel.
 *
 * Renders radio-card rows for each accessible pool with a GPU utilization
 * bar and free GPU count. Fetches all pools once on mount.
 */

"use client";

import { memo, useMemo } from "react";
import { cn } from "@/lib/utils";
import { usePools, useProfile } from "@/lib/api/adapter/hooks";
import type { Pool } from "@/lib/api/adapter/types";
import { Skeleton } from "@/components/shadcn/skeleton";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface PoolUtilization {
  pct: number;
  colorClass: string;
  textColorClass: string;
  freeLabel: string;
}

function getPoolUtilization(pool: Pool): PoolUtilization {
  const capacity = pool.quota.totalCapacity;
  const usage = pool.quota.totalUsage;
  const free = pool.quota.totalFree;

  if (capacity === 0) {
    return {
      pct: 0,
      colorClass: "bg-blue-400",
      textColorClass: "text-blue-500 dark:text-blue-400",
      freeLabel: "available",
    };
  }

  const pct = (usage / capacity) * 100;
  const freeLabel = free > 0 ? `${free}/${capacity} free` : "no GPUs free";

  if (pct < 50) {
    return { pct, colorClass: "bg-nvidia", textColorClass: "text-nvidia", freeLabel };
  }
  if (pct < 75) {
    return { pct, colorClass: "bg-amber-500", textColorClass: "text-amber-500 dark:text-amber-400", freeLabel };
  }
  return { pct, colorClass: "bg-red-500", textColorClass: "text-red-500 dark:text-red-400", freeLabel };
}

// ---------------------------------------------------------------------------
// Pool card
// ---------------------------------------------------------------------------

interface PoolCardProps {
  pool: Pool;
  isSelected: boolean;
  onSelect: () => void;
}

const PoolCard = memo(function PoolCard({ pool, isSelected, onSelect }: PoolCardProps) {
  const util = getPoolUtilization(pool);
  const description = pool.description || pool.platforms.join(" · ") || pool.backend;

  return (
    <button
      type="button"
      role="radio"
      aria-checked={isSelected}
      onClick={onSelect}
      className={cn(
        "group relative flex w-full cursor-pointer items-center gap-3 rounded-lg border p-3.5 text-left transition-all",
        isSelected
          ? "border-nvidia/60 bg-nvidia/5 dark:border-nvidia/40 dark:bg-nvidia/10"
          : "border-zinc-200 bg-white hover:border-zinc-300 hover:bg-zinc-50 dark:border-zinc-700/60 dark:bg-zinc-800/20 dark:hover:border-zinc-600 dark:hover:bg-zinc-800/40",
      )}
    >
      {/* Radio circle */}
      <div
        className={cn(
          "flex size-4 shrink-0 items-center justify-center rounded-full border transition-colors",
          isSelected ? "border-nvidia bg-nvidia" : "border-zinc-300 dark:border-zinc-600",
        )}
      >
        {isSelected && <div className="size-1.5 rounded-full bg-black" />}
      </div>

      {/* Pool info */}
      <div className="min-w-0 flex-1">
        <div className="mb-0.5 text-sm font-semibold text-zinc-900 dark:text-zinc-100">{pool.name}</div>
        <div className="truncate font-mono text-[11px] text-zinc-400 dark:text-zinc-500">{description}</div>
        {/* GPU bar */}
        <div className="mt-2 h-0.5 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-700">
          <div
            className={cn("h-full rounded-full transition-all", util.colorClass)}
            style={{ width: `${util.pct}%` }}
            aria-hidden="true"
          />
        </div>
      </div>

      {/* Free count */}
      <div className={cn("shrink-0 font-mono text-xs font-semibold", util.textColorClass)}>{util.freeLabel}</div>

      {/* Selected checkmark */}
      {isSelected && <div className="text-nvidia absolute top-3 right-3 font-mono text-[10px]">✓</div>}
    </button>
  );
});

// ---------------------------------------------------------------------------
// Section
// ---------------------------------------------------------------------------

export interface SubmitWorkflowPoolsProps {
  selected: string;
  onSelect: (poolName: string) => void;
}

export const SubmitWorkflowPools = memo(function SubmitWorkflowPools({ selected, onSelect }: SubmitWorkflowPoolsProps) {
  const { pools, isLoading } = usePools();
  const { profile } = useProfile();

  const accessiblePools = useMemo(() => {
    const accessibleNames = profile?.pool.accessible;
    if (!accessibleNames) return pools;
    const accessible = new Set(accessibleNames);
    return pools.filter((p) => accessible.has(p.name));
  }, [pools, profile]);

  if (isLoading) {
    return (
      <div className="flex flex-col gap-2">
        {[1, 2, 3].map((i) => (
          <Skeleton
            key={i}
            className="h-[72px] w-full rounded-lg"
          />
        ))}
      </div>
    );
  }

  if (accessiblePools.length === 0) {
    return <p className="py-4 text-center font-mono text-xs text-zinc-400 dark:text-zinc-500">No pools available</p>;
  }

  return (
    <div
      className="flex flex-col gap-2"
      role="radiogroup"
      aria-label="Target compute pool"
    >
      {accessiblePools.map((pool) => (
        <PoolCard
          key={pool.name}
          pool={pool}
          isSelected={selected === pool.name}
          onSelect={() => onSelect(pool.name)}
        />
      ))}
    </div>
  );
});
