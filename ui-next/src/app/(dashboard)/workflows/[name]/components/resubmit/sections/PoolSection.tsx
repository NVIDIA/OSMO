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
 * 1. On mount: Show preselected pool (workflow's original pool), fetch its metadata
 * 2. On dropdown open: Fetch ALL pools with loading indicator
 * 3. Pools load: Enable search, populate dropdown
 */

"use client";

import { memo, useState, useMemo } from "react";
import { CheckCircle2, Wrench, XCircle } from "lucide-react";
import { usePool } from "@/lib/api/adapter/hooks";
import { cn } from "@/lib/utils";
import { CapacityBar } from "@/components/capacity-bar";
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

/** Metadata card showing pool capacity and configuration */
const PoolMetaCard = memo(function PoolMetaCard({ pool }: { pool: NonNullable<ReturnType<typeof usePool>["pool"]> }) {
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

  // Fetch ONLY the selected pool's metadata (for PoolMetaCard and status badge)
  // This is a single API call, not all pools
  const { pool: selectedPool } = usePool(pool);

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
      />

      {selectedPool && <PoolMetaCard pool={selectedPool} />}
    </CollapsibleSection>
  );
});
