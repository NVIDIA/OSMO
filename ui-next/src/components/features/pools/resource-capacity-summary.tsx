"use client";

// Copyright (c) 2025, NVIDIA CORPORATION. All rights reserved.
//
// NVIDIA CORPORATION and its licensors retain all intellectual property
// and proprietary rights in and to this software, related documentation
// and any modifications thereto. Any use, reproduction, disclosure or
// distribution of this software and related documentation without an express
// license agreement from NVIDIA CORPORATION is strictly prohibited.

import { useMemo } from "react";
import { Cpu, HardDrive, MemoryStick, Zap } from "lucide-react";
import { cn, formatCompact } from "@/lib/utils";
import type { Resource } from "@/lib/api/adapter";
import type { ResourceDisplayMode } from "@/headless";

// =============================================================================
// Types
// =============================================================================

interface ResourceCapacitySummaryProps {
  resources: Resource[];
  displayMode?: ResourceDisplayMode;
  isLoading?: boolean;
}

interface CapacityTotals {
  gpu: { used: number; total: number };
  cpu: { used: number; total: number };
  memory: { used: number; total: number };
  storage: { used: number; total: number };
}

// =============================================================================
// Component
// =============================================================================

export function ResourceCapacitySummary({
  resources,
  displayMode = "free",
  isLoading = false,
}: ResourceCapacitySummaryProps) {
  // Calculate aggregated totals
  const totals = useMemo<CapacityTotals>(() => {
    return resources.reduce(
      (acc, resource) => ({
        gpu: { used: acc.gpu.used + resource.gpu.used, total: acc.gpu.total + resource.gpu.total },
        cpu: { used: acc.cpu.used + resource.cpu.used, total: acc.cpu.total + resource.cpu.total },
        memory: { used: acc.memory.used + resource.memory.used, total: acc.memory.total + resource.memory.total },
        storage: { used: acc.storage.used + resource.storage.used, total: acc.storage.total + resource.storage.total },
      }),
      {
        gpu: { used: 0, total: 0 },
        cpu: { used: 0, total: 0 },
        memory: { used: 0, total: 0 },
        storage: { used: 0, total: 0 },
      }
    );
  }, [resources]);

  // Shared card styles - equal width, fill container, wrap when narrow
  const cardClass = "min-w-[140px] flex-1 rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-950";

  if (isLoading) {
    return (
      <div className="flex flex-wrap gap-3">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className={cardClass}>
            <div className="flex items-center gap-2 mb-1">
              <div className="h-4 w-4 animate-pulse rounded bg-zinc-200 dark:bg-zinc-700" />
              <div className="h-3 w-12 animate-pulse rounded bg-zinc-200 dark:bg-zinc-700" />
            </div>
            <div className="h-6 w-24 animate-pulse rounded bg-zinc-200 dark:bg-zinc-700" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-wrap gap-3">
      <CapacityCard
        icon={Zap}
        label="GPU"
        used={totals.gpu.used}
        total={totals.gpu.total}
        displayMode={displayMode}
        colorClass="text-purple-500"
      />
      <CapacityCard
        icon={Cpu}
        label="CPU"
        used={totals.cpu.used}
        total={totals.cpu.total}
        displayMode={displayMode}
        colorClass="text-blue-500"
      />
      <CapacityCard
        icon={MemoryStick}
        label="Memory"
        used={totals.memory.used}
        total={totals.memory.total}
        unit="Gi"
        displayMode={displayMode}
        colorClass="text-emerald-500"
      />
      <CapacityCard
        icon={HardDrive}
        label="Storage"
        used={totals.storage.used}
        total={totals.storage.total}
        unit="Gi"
        displayMode={displayMode}
        colorClass="text-amber-500"
      />
    </div>
  );
}

// =============================================================================
// Sub-components
// =============================================================================

interface CapacityCardProps {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  used: number;
  total: number;
  unit?: string;
  displayMode: ResourceDisplayMode;
  colorClass: string;
}

function CapacityCard({
  icon: Icon,
  label,
  used,
  total,
  unit = "",
  displayMode,
  colorClass,
}: CapacityCardProps) {
  const free = total - used;
  
  // What to display based on mode
  const primaryValue = displayMode === "free" ? free : used;
  const primaryLabel = displayMode === "free" ? "free" : "used";

  return (
    <div className="min-w-[140px] flex-1 rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-950">
      {/* Header */}
      <div className="flex items-center gap-2 mb-1">
        <Icon className={cn("h-4 w-4", colorClass)} />
        <span className="text-xs font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
          {label}
        </span>
      </div>

      {/* Value */}
      {total > 0 ? (
        <div className="flex items-baseline gap-1 flex-wrap">
          <span className="text-xl font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">
            {formatCompact(primaryValue)}
          </span>
          {displayMode === "used" && (
            <span className="text-sm text-zinc-400 dark:text-zinc-500">
              / {formatCompact(total)}
            </span>
          )}
          {unit && (
            <span className="text-xs text-zinc-400 dark:text-zinc-500 ml-0.5">
              {unit}
            </span>
          )}
          <span className="text-xs text-zinc-400 dark:text-zinc-500 ml-1">
            {primaryLabel}
          </span>
        </div>
      ) : (
        <span className="text-sm text-zinc-400 dark:text-zinc-500">—</span>
      )}
    </div>
  );
}
