import { cn } from "@/lib/utils";

interface QuotaBarProps {
  used: number;
  limit: number;
  free: number;
  isLoading?: boolean;
}

export function QuotaBar({ used, limit, free, isLoading }: QuotaBarProps) {
  const percent = limit > 0 ? (used / limit) * 100 : 0;

  if (isLoading) {
    return (
      <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
        <div className="h-4 w-24 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
        <div className="mt-3 h-3 w-full animate-pulse rounded-full bg-zinc-200 dark:bg-zinc-800" />
        <div className="mt-2 h-3 w-48 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
      <div className="flex items-baseline justify-between">
        <span className="text-sm font-medium text-zinc-500 dark:text-zinc-400">
          GPU Quota
        </span>
        <span className="text-lg font-semibold tabular-nums">
          {used} <span className="text-zinc-400">/</span> {limit}
          <span className="ml-1 text-sm font-normal text-zinc-500">GPUs</span>
        </span>
      </div>

      {/* Progress bar */}
      <div className="mt-3 h-3 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
        <div
          className={cn(
            "h-full rounded-full transition-all duration-500",
            percent > 90
              ? "bg-red-500"
              : percent > 70
                ? "bg-amber-500"
                : "bg-emerald-500"
          )}
          style={{ width: `${Math.min(percent, 100)}%` }}
        />
      </div>

      {/* Availability message */}
      <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
        {free > 0 ? (
          <>
            <span className="font-medium text-emerald-600 dark:text-emerald-400">
              {free} available
            </span>{" "}
            for HIGH/NORMAL priority workflows
          </>
        ) : (
          <span className="text-amber-600 dark:text-amber-400">
            No quota available — LOW priority workflows may still run
          </span>
        )}
      </p>
    </div>
  );
}

