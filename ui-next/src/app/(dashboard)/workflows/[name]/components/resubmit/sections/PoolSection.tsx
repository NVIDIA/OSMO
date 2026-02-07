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
 * PoolSection - Pool selection with metadata card and availability badge.
 * Fetches pools via usePools() adapter hook.
 */

"use client";

import { memo, useState, useMemo } from "react";
import { Loader2 } from "lucide-react";
import { Badge } from "@/components/shadcn/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/shadcn/select";
import { usePools } from "@/lib/api/adapter/hooks";
import type { Pool } from "@/lib/api/adapter/types";
import { PoolStatus } from "@/lib/api/generated";
import { cn } from "@/lib/utils";
import { CapacityBar } from "@/components/capacity-bar";
import { PlatformPills } from "@/app/(dashboard)/pools/components/cells/platform-pills";
import { CollapsibleSection } from "./CollapsibleSection";

export interface PoolSectionProps {
  /** Currently selected pool name */
  pool: string;
  /** Callback when pool selection changes */
  onChange: (pool: string) => void;
}

/** Maps pool status to badge variant */
const STATUS_VARIANT: Record<PoolStatus, "default" | "secondary" | "destructive" | "outline"> = {
  [PoolStatus.ONLINE]: "default",
  [PoolStatus.MAINTENANCE]: "secondary",
  [PoolStatus.OFFLINE]: "destructive",
};

/** Maps pool status to display color */
const STATUS_COLOR: Record<PoolStatus, string> = {
  [PoolStatus.ONLINE]: "bg-green-500/10 text-green-700 border-green-200 dark:bg-green-500/20 dark:text-green-400 dark:border-green-800",
  [PoolStatus.MAINTENANCE]: "bg-yellow-500/10 text-yellow-700 border-yellow-200 dark:bg-yellow-500/20 dark:text-yellow-400 dark:border-yellow-800",
  [PoolStatus.OFFLINE]: "bg-red-500/10 text-red-700 border-red-200 dark:bg-red-500/20 dark:text-red-400 dark:border-red-800",
};

/** Metadata card showing pool capacity and configuration */
interface PoolMetaCardProps {
  pool: Pool;
}

const PoolMetaCard = memo(function PoolMetaCard({ pool }: PoolMetaCardProps) {
  return (
    <div
      className="bg-muted/50 mt-3 space-y-6 rounded-md p-4"
      role="region"
      aria-label={`Metadata for pool ${pool.name}`}
    >
      {/* GPU Quota */}
      <CapacityBar
        label="GPU Quota"
        used={pool.quota.used}
        total={pool.quota.limit}
        size="sm"
      />

      {/* GPU Capacity */}
      <CapacityBar
        label="GPU Capacity"
        used={pool.quota.totalUsage}
        total={pool.quota.totalCapacity}
        size="sm"
      />

      {/* Platforms */}
      <div>
        <div className="mb-2 flex items-baseline gap-2 text-sm text-zinc-600 dark:text-zinc-400">
          <span>Platforms</span>
          {pool.defaultPlatform && (
            <span className="text-muted-foreground text-xs">(default: {pool.defaultPlatform})</span>
          )}
        </div>
        <PlatformPills
          platforms={pool.platforms}
          expandable={true}
        />
      </div>

      {/* Backend */}
      <div>
        <div className="mb-2 text-sm text-zinc-600 dark:text-zinc-400">Backend</div>
        <div className="font-mono text-sm">{pool.backend || "N/A"}</div>
      </div>
    </div>
  );
});

export const PoolSection = memo(function PoolSection({ pool, onChange }: PoolSectionProps) {
  const [open, setOpen] = useState(true);
  const { pools, isLoading } = usePools();

  // Show ALL pools - let backend handle validation (admin may submit to maintenance pools)
  const availablePools = useMemo(() => pools, [pools]);

  const selectedPool = useMemo(() => pools.find((p) => p.name === pool), [pools, pool]);

  const statusBadge = useMemo(() => {
    if (!selectedPool) return null;
    return (
      <Badge
        variant="outline"
        className={cn("font-medium", STATUS_COLOR[selectedPool.status])}
      >
        {selectedPool.status}
      </Badge>
    );
  }, [selectedPool]);

  return (
    <CollapsibleSection
      step={2}
      title="Target Pool"
      open={open}
      onOpenChange={setOpen}
      badge={statusBadge}
      selectedValue={selectedPool ? selectedPool.name : undefined}
    >
      {isLoading ? (
        <div
          className="flex items-center justify-center py-6"
          aria-label="Loading pools"
        >
          <Loader2 className="text-muted-foreground size-5 animate-spin" />
        </div>
      ) : (
        <div className="flex flex-col gap-0">
          <Select
            value={pool}
            onValueChange={onChange}
          >
            <SelectTrigger
              id="pool-select"
              className="w-full"
              aria-label="Select pool for execution"
            >
              <SelectValue placeholder="Select a pool..." />
            </SelectTrigger>
            <SelectContent>
              {availablePools.map((p) => (
                <SelectItem
                  key={p.name}
                  value={p.name}
                >
                  {p.name} ({p.quota.free} GPUs available)
                </SelectItem>
              ))}
              {availablePools.length === 0 && (
                <div className="text-muted-foreground px-2 py-4 text-center text-sm">No pools available</div>
              )}
            </SelectContent>
          </Select>

          {selectedPool && <PoolMetaCard pool={selectedPool} />}
        </div>
      )}
    </CollapsibleSection>
  );
});
