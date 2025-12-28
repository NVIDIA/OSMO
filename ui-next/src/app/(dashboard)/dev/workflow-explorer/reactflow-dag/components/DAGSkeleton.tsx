// Copyright (c) 2025, NVIDIA CORPORATION. All rights reserved.
//
// NVIDIA CORPORATION and its licensors retain all intellectual property
// and proprietary rights in and to this software, related documentation
// and any modifications thereto. Any use, reproduction, disclosure or
// distribution of this software and related documentation without an express
// license agreement from NVIDIA CORPORATION is strictly prohibited.

/**
 * DAGSkeleton Component
 *
 * Loading skeleton for the DAG visualization.
 * Follows the production skeleton pattern from lib/styles.ts.
 */

import { cn } from "@/lib/utils";

interface DAGSkeletonProps {
  /** Number of skeleton nodes to show */
  nodeCount?: number;
  /** Layout direction for positioning */
  direction?: "TB" | "LR";
  /** Additional class names */
  className?: string;
}

/**
 * Skeleton loading state for the DAG visualization.
 * Shows placeholder nodes that animate while data is loading.
 */
export function DAGSkeleton({ nodeCount = 5, direction = "TB", className }: DAGSkeletonProps) {
  const isVertical = direction === "TB";

  return (
    <div
      className={cn(
        "flex items-center justify-center h-full w-full bg-zinc-950",
        isVertical ? "flex-col gap-8" : "flex-row gap-12",
        className,
      )}
      role="status"
      aria-label="Loading workflow visualization"
    >
      {Array.from({ length: nodeCount }).map((_, i) => (
        <div
          key={i}
          className="relative"
          style={{
            // Stagger animation for visual interest
            animationDelay: `${i * 100}ms`,
          }}
        >
          {/* Node skeleton */}
          <div
            className="rounded-lg border-2 border-zinc-700 bg-zinc-800/60 backdrop-blur-sm"
            style={{
              width: 180,
              height: 72,
              contain: "layout style",
            }}
          >
            {/* Header skeleton */}
            <div className="px-3 py-3 flex items-center gap-2">
              {/* Icon placeholder */}
              <div className="h-4 w-4 rounded-full skeleton-shimmer" />
              {/* Title placeholder */}
              <div className="h-4 flex-1 rounded skeleton-shimmer" />
            </div>
            {/* Subtitle placeholder */}
            <div className="px-3">
              <div className="h-3 w-24 rounded skeleton-shimmer" />
            </div>
          </div>

          {/* Connecting line (except for last node) */}
          {i < nodeCount - 1 && (
            <div
              className={cn(
                "absolute bg-zinc-700",
                isVertical
                  ? "left-1/2 -translate-x-1/2 top-full w-0.5 h-8"
                  : "top-1/2 -translate-y-1/2 left-full h-0.5 w-12",
              )}
            />
          )}
        </div>
      ))}

      {/* Screen reader text */}
      <span className="sr-only">Loading workflow visualization...</span>
    </div>
  );
}
