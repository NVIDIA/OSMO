/**
 * Copyright (c) 2025, NVIDIA CORPORATION. All rights reserved.
 *
 * NVIDIA CORPORATION and its licensors retain all intellectual property
 * and proprietary rights in and to this software, related documentation
 * and any modifications thereto. Any use, reproduction, disclosure or
 * distribution of this software and related documentation without an express
 * license agreement from NVIDIA CORPORATION is strictly prohibited.
 */

"use client";

import { memo, useMemo } from "react";
import { Share2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { progressTrack, getProgressColor } from "@/lib/styles";
import type { Pool } from "@/lib/api/adapter";
import { getSharingInfo } from "@/lib/api/adapter/transforms";

export interface PanelContentProps {
  pool: Pool;
  sharingGroups: string[][];
}

export const PanelContent = memo(function PanelContent({ pool, sharingGroups }: PanelContentProps) {
  const sharedWith = useMemo(() => getSharingInfo(pool.name, sharingGroups), [pool.name, sharingGroups]);

  const quotaPercent = pool.quota.limit > 0 ? (pool.quota.used / pool.quota.limit) * 100 : 0;
  const capacityPercent = pool.quota.totalCapacity > 0 ? (pool.quota.totalUsage / pool.quota.totalCapacity) * 100 : 0;

  return (
    <div className="flex-1 overflow-auto p-4">
      <div className="space-y-6">
        {pool.description && (
          <section>
            <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
              Description
            </h3>
            <p className="text-sm text-zinc-700 dark:text-zinc-300">{pool.description}</p>
          </section>
        )}

        <section>
          <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
            GPU Quota
          </h3>
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-zinc-600 dark:text-zinc-400">Used</span>
              <span className="font-mono text-zinc-900 dark:text-zinc-100">
                {pool.quota.used} / {pool.quota.limit}
              </span>
            </div>
            <div className={cn(progressTrack, "h-2")}>
              <div
                className={cn("h-full rounded-full transition-all", getProgressColor(quotaPercent))}
                style={{ width: `${Math.min(quotaPercent, 100)}%` }}
              />
            </div>
            <div className="flex items-center justify-between text-xs text-zinc-500 dark:text-zinc-400">
              <span>{pool.quota.free} free</span>
              <span>{Math.round(quotaPercent)}% utilized</span>
            </div>
          </div>
        </section>

        <section>
          <h3 className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
            GPU Capacity
            {sharedWith && (
              <span className="inline-flex items-center gap-1 rounded-full bg-gradient-to-r from-violet-500/10 to-fuchsia-500/10 px-2 py-0.5 text-[0.625rem] font-medium text-violet-700 ring-1 ring-inset ring-violet-500/20 dark:text-violet-300 dark:ring-violet-400/30">
                <span className="h-1.5 w-1.5 rounded-full bg-violet-500 dark:bg-violet-400" />
                Shared
              </span>
            )}
          </h3>
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-zinc-600 dark:text-zinc-400">Usage</span>
              <span className="font-mono text-zinc-900 dark:text-zinc-100">
                {pool.quota.totalUsage} / {pool.quota.totalCapacity}
              </span>
            </div>
            <div className={cn(progressTrack, "h-2")}>
              <div
                className={cn(
                  "h-full rounded-full transition-all",
                  sharedWith ? "pools-shared-capacity-bar" : getProgressColor(capacityPercent)
                )}
                style={{ width: `${Math.min(capacityPercent, 100)}%` }}
              />
            </div>
            <div className="flex items-center justify-between text-xs text-zinc-500 dark:text-zinc-400">
              <span>{pool.quota.totalFree} idle</span>
              <span>{Math.round(capacityPercent)}% utilized</span>
            </div>
          </div>

          {sharedWith && sharedWith.length > 0 && (
            <div className="mt-3 rounded-lg bg-gradient-to-r from-violet-500/[0.08] to-fuchsia-500/[0.05] p-3 ring-1 ring-inset ring-violet-500/15 dark:ring-violet-400/20">
              <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-violet-700 dark:text-violet-300">
                <Share2 className="h-3.5 w-3.5" />
                Shares capacity with
              </div>
              <div className="flex flex-wrap gap-1.5">
                {sharedWith.map((poolName) => (
                  <span
                    key={poolName}
                    className="inline-flex items-center rounded-md bg-white/60 px-2 py-1 text-xs font-medium text-zinc-700 ring-1 ring-inset ring-zinc-200 dark:bg-zinc-800/60 dark:text-zinc-300 dark:ring-zinc-700"
                  >
                    {poolName}
                  </span>
                ))}
              </div>
            </div>
          )}
        </section>

        <section>
          <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
            Platforms ({pool.platforms.length})
          </h3>
          <div className="flex flex-wrap gap-2">
            {pool.platforms.sort().map((platform) => (
              <Badge key={platform} variant="secondary">
                {platform}
              </Badge>
            ))}
          </div>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
            Backend
          </h3>
          <p className="font-mono text-sm text-zinc-700 dark:text-zinc-300">{pool.backend}</p>
        </section>
      </div>
    </div>
  );
});
