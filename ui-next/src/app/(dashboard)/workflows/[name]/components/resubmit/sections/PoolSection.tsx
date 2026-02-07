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
import { CollapsibleSection } from "./CollapsibleSection";

export interface PoolSectionProps {
  /** Currently selected pool name */
  pool: string;
  /** Callback when pool selection changes */
  onChange: (pool: string) => void;
}

const POOL_META_FIELDS = [
  { key: "hardware", label: "Hardware" },
  { key: "backend", label: "Backend" },
  { key: "available", label: "Available" },
  { key: "status", label: "Status" },
] as const;

/** Maps pool status to its display color class */
const STATUS_COLOR_CLASS: Record<PoolStatus, string> = {
  [PoolStatus.ONLINE]: "text-green-600 dark:text-green-400",
  [PoolStatus.OFFLINE]: "text-red-600 dark:text-red-400",
  [PoolStatus.MAINTENANCE]: "text-yellow-600 dark:text-yellow-400",
};

/** Metadata card showing pool details */
interface PoolMetaCardProps {
  pool: Pool;
}

const PoolMetaCard = memo(function PoolMetaCard({ pool }: PoolMetaCardProps) {
  const hardware = useMemo(() => {
    if (!pool.defaultPlatform) return "N/A";
    const config = pool.platformConfigs[pool.defaultPlatform];
    return config?.description ?? pool.defaultPlatform;
  }, [pool.defaultPlatform, pool.platformConfigs]);

  const metaValues: Record<string, string> = useMemo(
    () => ({
      hardware,
      backend: pool.backend || "N/A",
      available: `${pool.quota.free} GPUs`,
      status: pool.status,
    }),
    [hardware, pool.backend, pool.quota.free, pool.status],
  );

  return (
    <div
      className="bg-muted/50 mt-3 grid grid-cols-2 gap-3 rounded-md p-3"
      role="region"
      aria-label={`Metadata for pool ${pool.name}`}
    >
      {POOL_META_FIELDS.map(({ key, label }) => (
        <div
          key={key}
          className="flex flex-col gap-0.5"
        >
          <span className="text-muted-foreground text-[0.6875rem] font-medium tracking-wider uppercase">{label}</span>
          <span className={cn("font-mono text-sm font-medium", key === "status" && STATUS_COLOR_CLASS[pool.status])}>
            {metaValues[key]}
          </span>
        </div>
      ))}
    </div>
  );
});

export const PoolSection = memo(function PoolSection({ pool, onChange }: PoolSectionProps) {
  const [open, setOpen] = useState(true);
  const { pools, isLoading } = usePools();

  // Show ALL pools - let backend handle validation (admin may submit to maintenance pools)
  const availablePools = useMemo(() => pools, [pools]);

  const selectedPool = useMemo(() => pools.find((p) => p.name === pool), [pools, pool]);

  const availabilityBadge = useMemo(() => {
    if (!selectedPool) return null;
    return (
      <Badge
        variant="outline"
        className="border-nvidia/20 bg-nvidia-bg text-nvidia-dark dark:border-nvidia/30 dark:bg-nvidia-bg-dark dark:text-nvidia-light"
      >
        <span
          className="bg-nvidia size-1.5 rounded-full"
          aria-hidden="true"
        />
        {selectedPool.quota.free} Available
      </Badge>
    );
  }, [selectedPool]);

  return (
    <CollapsibleSection
      step={2}
      title="Target Pool"
      open={open}
      onOpenChange={setOpen}
      badge={availabilityBadge}
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
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="pool-select"
              className="text-sm font-medium"
            >
              Select pool for execution
            </label>
            <Select
              value={pool}
              onValueChange={onChange}
            >
              <SelectTrigger
                id="pool-select"
                className="w-full"
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
          </div>

          {selectedPool && <PoolMetaCard pool={selectedPool} />}
        </div>
      )}
    </CollapsibleSection>
  );
});
