import { cn } from "@/lib/utils";
import { card, skeleton, progressTrack, getProgressColor, text } from "@/lib/styles";

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
      <div className={cn(card.base, "p-4")}>
        <div className={cn(skeleton.base, skeleton.md, "w-24")} />
        <div className={cn(skeleton.base, "mt-3 h-3 w-full rounded-full")} />
        <div className={cn(skeleton.base, skeleton.sm, "mt-2 w-48")} />
      </div>
    );
  }

  return (
    <div className={cn(card.base, "p-4")}>
      <div className="flex items-baseline justify-between">
        <span className={text.muted}>GPU Quota</span>
        <span className="text-lg font-semibold tabular-nums">
          {used} <span className="text-zinc-400">/</span> {limit}
          <span className="ml-1 text-sm font-normal text-zinc-500">GPUs</span>
        </span>
      </div>

      {/* Progress bar */}
      <div className={cn("mt-3 h-3", progressTrack)}>
        <div
          className={cn(
            "h-full rounded-full transition-all duration-500",
            getProgressColor(percent)
          )}
          style={{ width: `${Math.min(percent, 100)}%` }}
        />
      </div>

      {/* Availability message */}
      <p className={cn("mt-2", text.muted)}>
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
