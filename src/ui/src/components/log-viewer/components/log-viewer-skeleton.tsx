// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION. All rights reserved.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
//
// SPDX-License-Identifier: Apache-2.0

/**
 * Log Viewer Skeleton
 *
 * Loading skeleton for the LogViewer component. Matches the exact layout
 * to prevent cumulative layout shift (CLS = 0).
 *
 * Layout matches LogViewer:
 * 1. SearchBar (top, includes filtering)
 * 2. TimelineContainer (optional)
 * 3. LogList (main content, full width)
 * 4. Footer (bottom)
 *
 * Used by:
 * - Suspense fallback during SSR streaming
 * - LogViewerContainer during initial data fetch
 */

import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/shadcn/skeleton";
import { ROW_HEIGHT_ESTIMATE, HISTOGRAM_HEIGHT, SKELETON_WIDTHS } from "@/components/log-viewer/lib/constants";

// Precomputed histogram bar data — avoids using array index as React key
const HISTOGRAM_BARS = Array.from({ length: 30 }, (_, barIdx) => ({
  id: `histogram-bar-${barIdx + 1}`,
  heightPct: `${30 + (barIdx % 5) * 15}%`,
}));

// =============================================================================
// Types
// =============================================================================

export interface LogViewerSkeletonProps {
  /** Show histogram section (default: true) */
  showHistogram?: boolean;
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
 * // Minimal skeleton (no histogram)
 * <LogViewerSkeleton showHistogram={false} />
 *
 * // As Suspense fallback
 * <Suspense fallback={<LogViewerSkeleton />}>
 *   <LogViewerWithData />
 * </Suspense>
 * ```
 */
export function LogViewerSkeleton({ showHistogram = true, className }: LogViewerSkeletonProps) {
  return (
    <div className={cn("flex h-full flex-col", className)}>
      {/* Section 1: SearchBar skeleton (includes filtering UI) */}
      <div className="shrink-0 border-b p-2">
        <div className="flex items-center gap-2">
          <Skeleton className="h-9 flex-1" />
          <Skeleton className="h-5 w-24" />
        </div>
      </div>

      {/* Section 2: Histogram skeleton */}
      {showHistogram && (
        <div
          className="shrink-0 border-b px-3 py-2"
          style={{ height: HISTOGRAM_HEIGHT + 16 }}
        >
          <div className="flex h-full items-end gap-1">
            {HISTOGRAM_BARS.map(({ id, heightPct }) => (
              <Skeleton
                key={id}
                className="flex-1"
                style={{ height: heightPct }}
              />
            ))}
          </div>
        </div>
      )}

      {/* Section 3: LogList skeleton (full width) */}
      <div className="min-h-0 flex-1 overflow-hidden">
        <div className="space-y-1 p-2">
          {SKELETON_WIDTHS.map((width) => (
            <Skeleton
              key={width}
              style={{ width, height: ROW_HEIGHT_ESTIMATE }}
            />
          ))}
        </div>
      </div>

      {/* Section 4: Footer skeleton */}
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
