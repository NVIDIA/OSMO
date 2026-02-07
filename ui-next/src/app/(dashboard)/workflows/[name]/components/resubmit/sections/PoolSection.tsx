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
 * PoolSection - Pool selection with metadata card and status badge.
 *
 * Lazy-loading strategy:
 * 1. On mount: Fetch only selected pool's metadata
 * 2. On dropdown open: Fetch ALL pools once, cache for subsequent selections
 * 3. After all pools loaded: Use cached data for selected pool (no new API calls)
 */

"use client";

import { memo, useState, useMemo, useCallback } from "react";
import { CheckCircle2, Wrench, XCircle } from "lucide-react";
import { useGetPoolQuotasApiPoolQuotaGet } from "@/lib/api/generated";
import { transformPoolsResponse, transformPoolDetail } from "@/lib/api/adapter/transforms";
import type { Pool } from "@/lib/api/adapter/types";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/shadcn/badge";
import { PlatformPills } from "@/app/(dashboard)/pools/components/cells/platform-pills";
import { PoolSelect } from "./PoolSelect";
import { CollapsibleSection } from "./CollapsibleSection";
import { getStatusDisplay, STATUS_STYLES, type StatusCategory } from "@/app/(dashboard)/pools/lib/constants";

export interface PoolSectionProps {
  /** Currently selected pool name */
  pool: string;
  /** Callback when pool selection changes */
  onChange: (pool: string) => void;
}

/** Status icons mapping (matches pools table) */
const STATUS_ICONS = {
  online: CheckCircle2,
  maintenance: Wrench,
  offline: XCircle,
} as const;

/** Grid row layout: fixed label column + flexible value column */
const META_ROW = "grid grid-cols-[5.625rem_1fr] items-baseline gap-6";
/** Subtle uppercase label for metadata rows */
const META_LABEL = "text-muted-foreground text-xs font-medium uppercase";

/** Metadata card showing pool capacity and configuration */
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
        {/* GPU Quota */}
        <div className={cn(META_ROW, "border-border/50 border-b pb-2")}>
          <div className={META_LABEL}>GPU Quota</div>
          <div className="flex flex-wrap items-baseline gap-y-1 tabular-nums">
            <span className="text-sm font-medium">
              {pool.quota.used}
              <span className="text-muted-foreground/50">/</span>
              {pool.quota.limit}
            </span>
            <span className="bg-muted/50 text-muted-foreground ml-px rounded px-2 py-0.5 text-xs font-medium">
              used
            </span>
            <Badge
              variant="outline"
              className="ml-2"
            >
              {quotaFree} free
            </Badge>
          </div>
        </div>

        {/* GPU Capacity */}
        <div className={cn(META_ROW, "border-border/50 border-b pb-2")}>
          <div className={META_LABEL}>GPU Capacity</div>
          <div className="flex flex-wrap items-baseline gap-y-1 tabular-nums">
            <span className="text-sm font-medium">
              {pool.quota.totalUsage}
              <span className="text-muted-foreground/50">/</span>
              {pool.quota.totalCapacity}
            </span>
            <span className="bg-muted/50 text-muted-foreground ml-px rounded px-2 py-0.5 text-xs font-medium">
              used
            </span>
            <Badge
              variant="outline"
              className="ml-2"
            >
              {capacityFree} free
            </Badge>
          </div>
        </div>

        {/* Platforms */}
        <div className={cn(META_ROW, "border-border/50 border-b pb-2")}>
          <div className={META_LABEL}>Platforms</div>
          <div className="min-w-0">
            <PlatformPills
              platforms={pool.platforms}
              expandable={true}
            />
          </div>
        </div>

        {/* Backend */}
        <div className={META_ROW}>
          <div className={META_LABEL}>Backend</div>
          <div>
            <Badge
              variant="outline"
              className="font-mono"
            >
              {pool.backend || "N/A"}
            </Badge>
          </div>
        </div>
      </div>
    </div>
  );
});

export const PoolSection = memo(function PoolSection({ pool, onChange }: PoolSectionProps) {
  const [open, setOpen] = useState(true);
  // Track if dropdown has ever been opened (triggers all-pools fetch)
  const [hasEverOpenedDropdown, setHasEverOpenedDropdown] = useState(false);

  // Fetch individual pool metadata (ONLY before dropdown opens)
  // Disabled after all-pools query to prevent redundant API calls
  const { data: individualPoolData } = useGetPoolQuotasApiPoolQuotaGet(
    {
      pools: [pool],
      all_pools: false,
    },
    {
      query: {
        enabled: !hasEverOpenedDropdown,
        select: useCallback(
          (rawData: unknown) => {
            if (!rawData) return null;
            return transformPoolDetail(rawData, pool);
          },
          [pool],
        ),
      },
    },
  );

  // Lazy-load ALL pools (only after dropdown opens at least once)
  // Once loaded, we use this data for ALL pool selections (no more individual queries)
  const { data: allPoolsData } = useGetPoolQuotasApiPoolQuotaGet(
    { all_pools: true },
    {
      query: {
        enabled: hasEverOpenedDropdown,
        select: useCallback((rawData: unknown) => {
          if (!rawData) return { pools: [], sharingGroups: [] };
          return transformPoolsResponse(rawData);
        }, []),
      },
    },
  );

  // Use all-pools data if available (preferred), fallback to individual pool query
  // This prevents new API calls when selecting different pools after all-pools is loaded
  const allPools = allPoolsData?.pools;
  const selectedPool = useMemo(() => {
    if (allPools) {
      return allPools.find((p) => p.name === pool);
    }
    return individualPoolData ?? null;
  }, [allPools, individualPoolData, pool]);

  const handleDropdownOpenChange = useCallback(
    (isOpen: boolean) => {
      if (isOpen && !hasEverOpenedDropdown) {
        setHasEverOpenedDropdown(true);
      }
    },
    [hasEverOpenedDropdown],
  );

  const statusBadge = useMemo(() => {
    if (!selectedPool) return null;

    const { category, label } = getStatusDisplay(selectedPool.status);
    const styles = STATUS_STYLES[category]?.badge;
    const Icon = STATUS_ICONS[category as StatusCategory];

    if (!styles) return null;

    return (
      <span className={cn("inline-flex items-center gap-1 rounded px-2 py-0.5", styles.bg)}>
        <Icon className={cn("h-3.5 w-3.5", styles.icon)} />
        <span className={cn("text-xs font-semibold", styles.text)}>{label}</span>
      </span>
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
      <PoolSelect
        value={pool}
        onValueChange={onChange}
        selectedPool={selectedPool ?? undefined}
        allPools={allPoolsData?.pools}
        onDropdownOpenChange={handleDropdownOpenChange}
      />

      {selectedPool && <PoolMetaCard pool={selectedPool} />}
    </CollapsibleSection>
  );
});
