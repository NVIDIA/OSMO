"use client";

import Link from "next/link";
import { cn } from "@/lib/utils";
import type { Pool, PoolStatus } from "@/lib/api/adapter";
import { PoolStatus as PoolStatusValue } from "@/lib/constants/ui";

interface PoolRowProps {
  pool: Pool;
  isDefault?: boolean;
}

const statusConfig: Record<PoolStatus, { icon: string; label: string; className: string }> = {
  [PoolStatusValue.ONLINE]: {
    icon: "🟢",
    label: "",
    className: "",
  },
  [PoolStatusValue.OFFLINE]: {
    icon: "🔴",
    label: "Offline",
    className: "opacity-50",
  },
  [PoolStatusValue.MAINTENANCE]: {
    icon: "🟡",
    label: "Maintenance",
    className: "opacity-70",
  },
};

export function PoolRow({ pool, isDefault }: PoolRowProps) {
  const status = statusConfig[pool.status];
  const available = pool.quota.limit - pool.quota.used;
  const quotaPercent = pool.quota.limit > 0 ? (pool.quota.used / pool.quota.limit) * 100 : 0;
  const isAvailable = pool.status === PoolStatusValue.ONLINE;

  return (
    <Link
      href={`/pools/${pool.name}`}
      className={cn(
        "flex items-center justify-between gap-4 px-4 py-3 transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-900",
        status.className,
        isDefault && "bg-zinc-50 dark:bg-zinc-900/50"
      )}
    >
      {/* Left: Status + Name + Meta */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm">{status.icon}</span>
          <span className="font-medium text-zinc-900 dark:text-zinc-100">
            {pool.name}
          </span>
          {status.label && (
            <span className="rounded bg-zinc-200 px-1.5 py-0.5 text-xs font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
              {status.label}
            </span>
          )}
        </div>
        <div className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
          {pool.description || `${pool.platforms.length} platforms`}
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
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
                <div
                  className={cn(
                    "h-full rounded-full transition-all",
                    quotaPercent > 90
                      ? "bg-red-500"
                      : quotaPercent > 70
                        ? "bg-amber-500"
                        : "bg-emerald-500"
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
        <div className="h-4 w-32 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
        <div className="h-3 w-48 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
      </div>
      <div className="flex items-center gap-4">
        <div className="h-4 w-32 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
        <div className="h-4 w-16 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
      </div>
    </div>
  );
}
