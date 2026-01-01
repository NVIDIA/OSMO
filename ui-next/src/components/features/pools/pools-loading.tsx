/**
 * Copyright (c) 2025, NVIDIA CORPORATION. All rights reserved.
 *
 * NVIDIA CORPORATION and its licensors retain all intellectual property
 * and proprietary rights in and to this software, related documentation
 * and any modifications thereto. Any use, reproduction, disclosure or
 * distribution of this software and related documentation without an express
 * license agreement from NVIDIA CORPORATION is strictly prohibited.
 */

/**
 * Pools Loading Skeleton
 *
 * Matches the unified pools table layout for smooth loading → loaded transition.
 * Layout:
 * - Toolbar skeleton
 * - Single table card with:
 *   - Sticky header (skeleton)
 *   - Section headers (skeleton)
 *   - Pool rows (skeleton with shimmer)
 */

import { cn } from "@/lib/utils";
import { card } from "@/lib/styles";

// =============================================================================
// Skeleton Row
// =============================================================================

interface SkeletonRowProps {
  index: number;
  compact?: boolean;
}

function SkeletonRow({ index, compact }: SkeletonRowProps) {
  const baseDelay = index * 80;
  const height = compact ? "h-4" : "h-5";

  return (
    <div
      className={cn(
        "grid items-center gap-6 px-3 border-b border-zinc-100 dark:border-zinc-800",
        compact ? "py-2" : "py-3",
      )}
      style={{
        gridTemplateColumns: "minmax(160px, 2fr) minmax(200px, 3fr) minmax(120px, 1fr) minmax(140px, 1.5fr) minmax(100px, 1fr) minmax(100px, 1fr)",
      }}
    >
      {/* Name */}
      <div className="flex items-center gap-2">
        <div
          className="size-2 skeleton-shimmer rounded-full"
          style={{ animationDelay: `${baseDelay}ms` }}
        />
        <div
          className={cn(height, "w-24 skeleton-shimmer rounded")}
          style={{ animationDelay: `${baseDelay + 20}ms` }}
        />
      </div>

      {/* Description */}
      <div
        className={cn(height, "w-40 skeleton-shimmer rounded")}
        style={{ animationDelay: `${baseDelay + 40}ms` }}
      />

      {/* Quota */}
      <div className="space-y-1">
        <div
          className="h-3 w-16 skeleton-shimmer rounded"
          style={{ animationDelay: `${baseDelay + 60}ms` }}
        />
        <div
          className="h-1.5 w-full skeleton-shimmer rounded-full"
          style={{ animationDelay: `${baseDelay + 80}ms` }}
        />
      </div>

      {/* Capacity */}
      <div className="space-y-1">
        <div
          className="h-3 w-20 skeleton-shimmer rounded"
          style={{ animationDelay: `${baseDelay + 100}ms` }}
        />
        <div
          className="h-1.5 w-full skeleton-shimmer rounded-full"
          style={{ animationDelay: `${baseDelay + 120}ms` }}
        />
      </div>

      {/* Platforms */}
      <div className="flex gap-1">
        <div
          className="h-5 w-12 skeleton-shimmer rounded-full"
          style={{ animationDelay: `${baseDelay + 140}ms` }}
        />
        <div
          className="h-5 w-8 skeleton-shimmer rounded-full"
          style={{ animationDelay: `${baseDelay + 160}ms` }}
        />
      </div>

      {/* Backend */}
      <div
        className={cn(height, "w-16 skeleton-shimmer rounded font-mono")}
        style={{ animationDelay: `${baseDelay + 180}ms` }}
      />
    </div>
  );
}

// =============================================================================
// Section Header Skeleton
// =============================================================================

interface SectionHeaderSkeletonProps {
  icon: string;
  label: string;
  index: number;
}

function SectionHeaderSkeleton({ icon, label, index }: SectionHeaderSkeletonProps) {
  return (
    <div
      className={cn(
        "flex items-center gap-2 px-3 py-2",
        "bg-zinc-100 dark:bg-zinc-800",
        "border-y border-zinc-200 dark:border-zinc-700",
      )}
      style={{ animationDelay: `${index * 100}ms` }}
    >
      <div className="size-4 skeleton-shimmer rounded" />
      <span className="text-sm">{icon}</span>
      <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">{label}</span>
      <div className="h-4 w-6 skeleton-shimmer rounded" />
    </div>
  );
}

// =============================================================================
// Main Component
// =============================================================================

export interface PoolsLoadingProps {
  /** Use compact mode for rows */
  compact?: boolean;
  /** Custom className */
  className?: string;
}

export function PoolsLoading({ compact = false, className }: PoolsLoadingProps) {
  return (
    <div
      className={cn("flex h-full flex-col gap-4", className)}
      role="status"
      aria-label="Loading pools"
      style={{ contain: "layout" }}
    >
      {/* Toolbar skeleton */}
      <div className="flex shrink-0 items-center justify-between gap-4">
        {/* Search bar */}
        <div className="h-10 flex-1 max-w-md skeleton-shimmer rounded-lg" />

        {/* Controls */}
        <div className="flex items-center gap-2">
          <div className="h-9 w-24 skeleton-shimmer rounded" />
          <div className="h-9 w-9 skeleton-shimmer rounded" />
          <div className="h-9 w-9 skeleton-shimmer rounded" />
        </div>
      </div>

      {/* Unified table card - fills remaining space with min height */}
      <div className={cn(card.base, "min-h-[400px] flex-1 overflow-hidden")}>
        {/* Table header skeleton */}
        <div
          className="grid items-center gap-6 border-b border-zinc-200 bg-zinc-50 px-3 py-2.5 dark:border-zinc-700 dark:bg-zinc-800/50"
          style={{
            gridTemplateColumns: "minmax(160px, 2fr) minmax(200px, 3fr) minmax(120px, 1fr) minmax(140px, 1.5fr) minmax(100px, 1fr) minmax(100px, 1fr)",
          }}
        >
          {["Name", "Description", "Quota", "Capacity", "Platforms", "Backend"].map((col, i) => (
            <div
              key={col}
              className="h-3 w-16 skeleton-shimmer rounded"
              style={{ animationDelay: `${i * 50}ms` }}
            />
          ))}
        </div>

        {/* Section: Online */}
        <SectionHeaderSkeleton icon="🟢" label="Online" index={0} />
        {Array.from({ length: 4 }).map((_, i) => (
          <SkeletonRow key={`online-${i}`} index={i} compact={compact} />
        ))}

        {/* Section: Maintenance */}
        <SectionHeaderSkeleton icon="🟡" label="Maintenance" index={1} />
        <SkeletonRow index={4} compact={compact} />

        {/* Section: Offline */}
        <SectionHeaderSkeleton icon="🔴" label="Offline" index={2} />
        <SkeletonRow index={5} compact={compact} />
      </div>

      {/* Screen reader announcement */}
      <span className="sr-only">Loading pools data, please wait...</span>
    </div>
  );
}
