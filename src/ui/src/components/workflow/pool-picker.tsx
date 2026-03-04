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

import { memo, useState, useMemo, useCallback } from "react";
import { usePool, usePools, useProfile } from "@/lib/api/adapter/hooks";
import type { Pool } from "@/lib/api/adapter/types";
import { cn } from "@/lib/utils";
import { PlatformPills } from "@/components/platform-pills";
import { PoolSelect } from "@/components/workflow/pool-select";

const META_ROW = "grid grid-cols-[5.625rem_1fr] items-baseline gap-6";
const META_LABEL = "text-muted-foreground text-xs font-medium uppercase";

const PoolMetaCard = memo(function PoolMetaCard({ pool }: { pool: Pool }) {
  const quotaFree = pool.quota.limit - pool.quota.used;
  const capacityFree = pool.quota.totalCapacity - pool.quota.totalUsage;

  return (
    <div
      className="bg-muted/50 mt-3 rounded-md p-4"
      role="region"
      aria-label={`Metadata for pool ${pool.name}`}
    >
      <div className="space-y-3">
        <div className={cn(META_ROW, "border-border/50 border-b pb-2")}>
          <div className={META_LABEL}>GPU Quota</div>
          <div className="flex flex-wrap items-baseline gap-y-1 tabular-nums">
            <span className="text-sm font-medium">
              {pool.quota.used}
              <span className="text-muted-foreground/50"> / </span>
              {pool.quota.limit}
            </span>
            <span className="text-muted-foreground pl-[0.3rem] text-xs font-medium">used</span>
            <span className="text-muted-foreground px-2">•</span>
            <span className="text-xs font-medium">{quotaFree} free</span>
          </div>
        </div>

        <div className={cn(META_ROW, "border-border/50 border-b pb-2")}>
          <div className={META_LABEL}>GPU Capacity</div>
          <div className="flex flex-wrap items-baseline gap-y-1 tabular-nums">
            <span className="text-sm font-medium">
              {pool.quota.totalUsage}
              <span className="text-muted-foreground/50"> / </span>
              {pool.quota.totalCapacity}
            </span>
            <span className="text-muted-foreground pl-[0.3rem] text-xs font-medium">used</span>
            <span className="text-muted-foreground px-2">•</span>
            <span className="text-xs font-medium">{capacityFree} free</span>
          </div>
        </div>

        <div className={cn(META_ROW, "border-border/50 border-b pb-2")}>
          <div className={META_LABEL}>Platforms</div>
          <div className="min-w-0">
            <PlatformPills
              platforms={pool.platforms}
              expandable={true}
            />
          </div>
        </div>

        <div className={META_ROW}>
          <div className={META_LABEL}>Backend</div>
          <div>
            <pre className="text-sm font-medium">{pool.backend || "N/A"}</pre>
          </div>
        </div>
      </div>
    </div>
  );
});

export interface PoolPickerProps {
  pool: string;
  onChange: (pool: string) => void;
}

export const PoolPicker = memo(function PoolPicker({ pool, onChange }: PoolPickerProps) {
  const [hasEverOpenedDropdown, setHasEverOpenedDropdown] = useState(false);

  // Fetch individual pool metadata only until the dropdown opens (then all-pools takes over)
  const { pool: individualPoolData } = usePool(pool, !hasEverOpenedDropdown && !!pool);
  const { pools: allPools } = usePools(hasEverOpenedDropdown);

  const { profile } = useProfile();
  const accessiblePoolNames = profile?.pool.accessible;
  const accessibleSet = useMemo(
    () => (accessiblePoolNames ? new Set(accessiblePoolNames) : null),
    [accessiblePoolNames],
  );

  const selectedPool = useMemo(() => {
    if (allPools) return allPools.find((p) => p.name === pool);
    return individualPoolData ?? null;
  }, [allPools, individualPoolData, pool]);

  const accessiblePools = useMemo(() => {
    if (!allPools) return undefined;
    if (!accessibleSet) return allPools;
    return allPools.filter((p) => accessibleSet.has(p.name));
  }, [allPools, accessibleSet]);

  const handleDropdownOpenChange = useCallback(
    (isOpen: boolean) => {
      if (isOpen && !hasEverOpenedDropdown) {
        setHasEverOpenedDropdown(true);
      }
    },
    [hasEverOpenedDropdown],
  );

  return (
    <>
      <PoolSelect
        value={pool}
        onValueChange={onChange}
        selectedPool={selectedPool ?? undefined}
        allPools={accessiblePools}
        onDropdownOpenChange={handleDropdownOpenChange}
      />
      {selectedPool && <PoolMetaCard pool={selectedPool} />}
    </>
  );
});
