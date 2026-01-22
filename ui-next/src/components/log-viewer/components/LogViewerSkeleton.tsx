// Copyright (c) 2026, NVIDIA CORPORATION. All rights reserved.
//
// NVIDIA CORPORATION and its licensors retain all intellectual property
// and proprietary rights in and to this software, related documentation
// and any modifications thereto. Any use, reproduction, disclosure or
// distribution of this software and related documentation without an express
// license agreement from NVIDIA CORPORATION is strictly prohibited.

/**
 * Log Viewer Skeleton
 *
 * Loading skeleton for the LogViewer component. Matches the exact layout
 * to prevent cumulative layout shift (CLS = 0).
 *
 * Layout matches LogViewer:
 * 1. SearchBar (top)
 * 2. FacetBar (optional, shows filter dropdowns)
 * 3. TimelineHistogram (optional)
 * 4. LogList (main content, full width)
 * 5. Footer (bottom)
 *
 * Used by:
 * - Suspense fallback during SSR streaming
 * - LogViewerContainer during initial data fetch
 */

import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/shadcn/skeleton";
import { ROW_HEIGHT_ESTIMATE, HISTOGRAM_HEIGHT, SKELETON_WIDTHS } from "../lib/constants";

// =============================================================================
// Types
// =============================================================================

export interface LogViewerSkeletonProps {
  /** Show histogram section (default: true) */
  showHistogram?: boolean;
  /** Show facet bar with filter dropdowns (default: true) */
  showFacetBar?: boolean;
  /** Additional class names */
  className?: string;
}

// =============================================================================
// Component
// =============================================================================

/**
 * Skeleton component matching LogViewer layout.
 *
 * @example
 * ```tsx
 * // Full skeleton
 * <LogViewerSkeleton />
 *
 * // Minimal skeleton (no histogram or facets)
 * <LogViewerSkeleton showHistogram={false} showFacetBar={false} />
 *
 * // As Suspense fallback
 * <Suspense fallback={<LogViewerSkeleton />}>
 *   <LogViewerWithData />
 * </Suspense>
 * ```
 */
export function LogViewerSkeleton({ showHistogram = true, showFacetBar = true, className }: LogViewerSkeletonProps) {
  return (
    <div className={cn("flex h-full flex-col", className)}>
      {/* Section 1: SearchBar skeleton */}
      <div className="shrink-0 border-b px-3 py-2">
        <div className="flex items-center gap-2">
          <Skeleton className="h-9 flex-1" />
          <Skeleton className="h-5 w-24" />
        </div>
      </div>

      {/* Section 2: FacetBar skeleton */}
      {showFacetBar && (
        <div className="shrink-0 border-b px-3 py-3">
          <div className="flex items-center gap-2">
            <Skeleton className="h-8 w-20" />
            <Skeleton className="h-8 w-20" />
            <Skeleton className="h-8 w-20" />
          </div>
        </div>
      )}

      {/* Section 3: Histogram skeleton */}
      {showHistogram && (
        <div
          className="shrink-0 border-b px-3 py-2"
          style={{ height: HISTOGRAM_HEIGHT + 16 }}
        >
          <div className="flex h-full items-end gap-1">
            {Array.from({ length: 30 }).map((_, i) => (
              <Skeleton
                key={i}
                className="flex-1"
                style={{ height: `${30 + (i % 5) * 15}%` }}
              />
            ))}
          </div>
        </div>
      )}

      {/* Section 4: LogList skeleton (full width) */}
      <div className="min-h-0 flex-1 overflow-hidden">
        <div className="space-y-1 p-2">
          {SKELETON_WIDTHS.map((width, i) => (
            <Skeleton
              key={i}
              style={{ width, height: ROW_HEIGHT_ESTIMATE }}
            />
          ))}
        </div>
      </div>

      {/* Section 5: Footer skeleton */}
      <div className="shrink-0">
        <div className="flex items-center justify-between border-t px-3 py-2">
          <div className="flex gap-1">
            <Skeleton className="size-8" />
            <Skeleton className="size-8" />
            <Skeleton className="size-8" />
          </div>
          <Skeleton className="size-8" />
        </div>
      </div>
    </div>
  );
}
