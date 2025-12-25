// Copyright (c) 2025, NVIDIA CORPORATION. All rights reserved.
//
// NVIDIA CORPORATION and its licensors retain all intellectual property
// and proprietary rights in and to this software, related documentation
// and any modifications thereto. Any use, reproduction, disclosure or
// distribution of this software and related documentation without an express
// license agreement from NVIDIA CORPORATION is strictly prohibited.

/**
 * Dashboard loading skeleton.
 *
 * Performance optimized:
 * - Matches actual page layout to prevent CLS
 * - Uses GPU-accelerated shimmer animation
 * - Semantic structure for screen readers
 */
export default function Loading() {
  return (
    <div
      className="flex h-full flex-col gap-6"
      role="status"
      aria-label="Loading content"
      style={{ contain: "layout" }}
    >
      {/* Page header skeleton - matches actual header dimensions */}
      <div className="shrink-0 space-y-2">
        <div className="h-8 w-48 skeleton-shimmer rounded" />
        <div className="h-4 w-72 skeleton-shimmer rounded" />
      </div>

      {/* Main content skeleton - fills remaining space */}
      <div
        className="min-h-0 flex-1 rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950"
        style={{ contain: "layout paint" }}
      >
        {/* Filter bar skeleton */}
        <div className="border-b border-zinc-100 p-4 dark:border-zinc-800/50">
          <div className="flex items-center gap-3">
            <div className="h-9 w-64 skeleton-shimmer rounded" />
            <div className="h-9 w-24 skeleton-shimmer rounded" />
            <div className="h-9 w-24 skeleton-shimmer rounded" />
          </div>
        </div>

        {/* Table skeleton */}
        <div className="p-4">
          {/* Table header skeleton */}
          <div className="mb-4 flex items-center gap-4 border-b border-zinc-100 pb-3 dark:border-zinc-800/50">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <div
                key={i}
                className="h-4 flex-1 skeleton-shimmer rounded"
              />
            ))}
          </div>

          {/* Table rows skeleton */}
          <div className="space-y-3">
            {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
              <div
                key={i}
                className="flex items-center gap-4"
              >
                {[1, 2, 3, 4, 5, 6].map((j) => (
                  <div
                    key={j}
                    className="h-6 flex-1 skeleton-shimmer rounded"
                    style={{ animationDelay: `${(i * 6 + j) * 50}ms` }}
                  />
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Screen reader announcement */}
      <span className="sr-only">Content is loading, please wait...</span>
    </div>
  );
}
