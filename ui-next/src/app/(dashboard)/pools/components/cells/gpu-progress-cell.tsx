/**
 * Copyright (c) 2025-2026, NVIDIA CORPORATION. All rights reserved.
 *
 * NVIDIA CORPORATION and its licensors retain all intellectual property
 * and proprietary rights in and to this software, related documentation
 * and any modifications thereto. Any use, reproduction, disclosure or
 * distribution of this software and related documentation without an express
 * license agreement from NVIDIA CORPORATION is strictly prohibited.
 */

"use client";

import { memo, useCallback } from "react";
import { Share2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { InlineProgress, type DisplayMode } from "@/components/inline-progress";
import type { Quota } from "@/lib/api/adapter";

// =============================================================================
// Types
// =============================================================================

export interface GpuProgressCellProps {
  /** Pool quota data */
  quota: Quota;
  /** Which quota type to display */
  type: "quota" | "capacity";
  /** Display used/total or free count */
  displayMode: DisplayMode;
  /** Compact mode: text only, no progress bar */
  compact?: boolean;
  /** Whether this pool shares capacity with others */
  isShared?: boolean;
  /** Callback when share icon is clicked - filters to show only pools in the same sharing group */
  onFilterBySharedPools?: () => void;
}

// =============================================================================
// Share Icon Component
// =============================================================================

interface ShareIconProps {
  compact: boolean;
  interactive: boolean;
  onClick?: (e: React.MouseEvent | React.KeyboardEvent) => void;
}

const ShareIcon = memo(function ShareIcon({ compact, interactive, onClick }: ShareIconProps) {
  const iconSize = compact ? "h-3 w-3" : "h-3.5 w-3.5";

  if (interactive && onClick) {
    const handleKeyDown = (e: React.KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onClick(e);
      }
    };

    return (
      <button
        type="button"
        onClick={onClick}
        onKeyDown={handleKeyDown}
        className="inline-flex items-center justify-center rounded p-0.5 text-violet-500 transition-colors hover:bg-violet-100 hover:text-violet-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 dark:text-violet-400 dark:hover:bg-violet-900/30 dark:hover:text-violet-300"
        aria-label="Filter to show only pools sharing capacity with this pool"
      >
        <Share2 className={iconSize} aria-hidden="true" />
      </button>
    );
  }

  return (
    <Share2
      className={cn("text-violet-500 dark:text-violet-400", iconSize)}
      aria-label="This pool shares capacity with other pools"
    />
  );
});

// =============================================================================
// Component
// =============================================================================

/**
 * GpuProgressCell - Pool-specific progress cell for quota/capacity columns.
 *
 * Composes from InlineProgress and adds pool-specific share icon.
 *
 * @example
 * ```tsx
 * <GpuProgressCell quota={pool.quota} type="quota" displayMode="used" />
 * <GpuProgressCell quota={pool.quota} type="capacity" displayMode="free" isShared />
 * ```
 */
export const GpuProgressCell = memo(function GpuProgressCell({
  quota,
  type,
  displayMode,
  compact = false,
  isShared = false,
  onFilterBySharedPools,
}: GpuProgressCellProps) {
  // Extract values based on type
  const used = type === "quota" ? quota.used : quota.totalUsage;
  const total = type === "quota" ? quota.limit : quota.totalCapacity;
  const freeLabel = type === "quota" ? "free" : "idle";

  const handleShareClick = useCallback(
    (e: React.MouseEvent | React.KeyboardEvent) => {
      e.stopPropagation();
      onFilterBySharedPools?.();
    },
    [onFilterBySharedPools]
  );

  return (
    <InlineProgress
      used={used}
      total={total}
      displayMode={displayMode}
      compact={compact}
      freeLabel={freeLabel}
    >
      {isShared && (
        <ShareIcon
          compact={compact}
          interactive={!!onFilterBySharedPools}
          onClick={onFilterBySharedPools ? handleShareClick : undefined}
        />
      )}
    </InlineProgress>
  );
});
