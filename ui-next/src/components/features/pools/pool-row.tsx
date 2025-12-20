"use client";

import Link from "next/link";
import { cn } from "@/lib/utils";
import { card, skeleton, progressTrack, getProgressColor, badge } from "@/lib/styles";
import type { Pool } from "@/lib/api/adapter";
import { PoolStatus } from "@/lib/constants/ui";

interface PoolRowProps {
  pool: Pool;
  isDefault?: boolean;
}

export function PoolRow({ pool, isDefault }: PoolRowProps) {
  const available = pool.quota.limit - pool.quota.used;
  const quotaPercent =
    pool.quota.limit > 0 ? (pool.quota.used / pool.quota.limit) * 100 : 0;
  const isAvailable = pool.status === PoolStatus.ONLINE;

  return (
    <Link
      href={`/pools/${pool.name}`}
      className={cn(
        "flex items-center justify-between gap-4 px-4 py-3",
        card.hover,
        !isAvailable && "opacity-60",
        isDefault && "bg-zinc-50 dark:bg-zinc-900/50"
      )}
    >
      {/* Left: Name + Description */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="font-medium text-zinc-900 dark:text-zinc-100">
            {pool.name}
          </span>
          {isDefault && <span className={badge.success}>Default</span>}
        </div>
        <div className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
          {pool.description ||
            `${pool.platforms.length} platform${pool.platforms.length !== 1 ? "s" : ""}`}
        </div>
      </div>

      {/* Right: Quota bar + availability */}
      <div className="flex items-center gap-4">
        {isAvailable ? (
          <>
            {/* Quota bar */}
            <div className="w-32">
              <div className="flex items-center justify-between text-xs">
                <span className="text-zinc-500 dark:text-zinc-400">GPU</span>
                <span className="font-medium tabular-nums">
                  {pool.quota.used}/{pool.quota.limit}
                </span>
              </div>
              <div className={cn("mt-1 h-1.5", progressTrack)}>
                <div
                  className={cn(
                    "h-full rounded-full transition-all",
                    getProgressColor(quotaPercent)
                  )}
                  style={{ width: `${Math.min(quotaPercent, 100)}%` }}
                />
              </div>
            </div>

            {/* Available count */}
            <div className="w-20 text-right">
              <div className="text-sm font-medium tabular-nums text-zinc-900 dark:text-zinc-100">
                {available}
              </div>
              <div className="text-xs text-zinc-500 dark:text-zinc-400">
                available
              </div>
            </div>
          </>
        ) : (
          <div className="w-52 text-right text-sm text-zinc-400 dark:text-zinc-500">
            —
          </div>
        )}
      </div>
    </Link>
  );
}

export function PoolRowSkeleton() {
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-3">
      <div className="flex-1 space-y-2">
        <div className={cn(skeleton.base, skeleton.md, "w-32")} />
        <div className={cn(skeleton.base, skeleton.sm, "w-48")} />
      </div>
      <div className="flex items-center gap-4">
        <div className={cn(skeleton.base, skeleton.md, "w-32")} />
        <div className={cn(skeleton.base, skeleton.md, "w-16")} />
      </div>
    </div>
  );
}
