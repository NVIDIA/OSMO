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
  /** Show fields pane sidebar (default: true) */
  showFieldsPane?: boolean;
  /** Show toolbar at bottom (default: true) */
  showToolbar?: boolean;
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
 * // Minimal skeleton (no histogram or fields)
 * <LogViewerSkeleton showHistogram={false} showFieldsPane={false} />
 *
 * // As Suspense fallback
 * <Suspense fallback={<LogViewerSkeleton />}>
 *   <LogViewerWithData />
 * </Suspense>
 * ```
 */
export function LogViewerSkeleton({
  showHistogram = true,
  showFieldsPane = true,
  showToolbar = true,
  className,
}: LogViewerSkeletonProps) {
  return (
    <div className={cn("flex h-full flex-col", className)}>
      {/* QueryBar skeleton */}
      <div className="shrink-0 border-b px-3 py-2">
        <div className="flex items-center gap-2">
          <Skeleton className="h-9 flex-1" />
          <Skeleton className="h-5 w-24" />
        </div>
      </div>

      {/* Histogram skeleton */}
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

      {/* Main content area: FieldsPane + LogList */}
      <div className="flex min-h-0 flex-1">
        {/* FieldsPane skeleton */}
        {showFieldsPane && (
          <div className="w-48 shrink-0 space-y-4 border-r p-3">
            {["level", "source", "task"].map((field) => (
              <div
                key={field}
                className="space-y-2"
              >
                <span className="text-muted-foreground text-xs font-medium">{field}</span>
                <div className="space-y-1">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <div
                      key={i}
                      className="flex items-center justify-between"
                    >
                      <Skeleton className="h-4 w-16" />
                      <Skeleton className="h-4 w-8" />
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* LogList skeleton */}
        <div className="flex-1 space-y-1 p-2">
          {SKELETON_WIDTHS.map((width, i) => (
            <Skeleton
              key={i}
              style={{ width, height: ROW_HEIGHT_ESTIMATE }}
            />
          ))}
        </div>
      </div>

      {/* Toolbar skeleton */}
      {showToolbar && (
        <div className="shrink-0 border-t px-3 py-2">
          <div className="flex items-center justify-between">
            <div className="flex gap-2">
              <Skeleton className="h-8 w-8" />
              <Skeleton className="h-8 w-8" />
              <Skeleton className="h-8 w-8" />
              <Skeleton className="h-8 w-8" />
            </div>
            <Skeleton className="h-4 w-24" />
          </div>
        </div>
      )}
    </div>
  );
}
