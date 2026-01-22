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

import { Skeleton } from "@/components/shadcn/skeleton";

/**
 * Dashboard loading skeleton.
 *
 * Performance optimized:
 * - Matches actual page layout to prevent CLS
 * - Uses shadcn Skeleton with pulse animation
 * - Semantic structure for screen readers
 */
export default function Loading() {
  return (
    <div
      className="flex h-full flex-col gap-6 p-6 contain-layout"
      role="status"
      aria-label="Loading content"
    >
      {/* Page header skeleton - matches actual header dimensions */}
      <div className="shrink-0 space-y-2">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-72" />
      </div>

      {/* Main content skeleton - fills remaining space */}
      <div className="contain-layout-paint min-h-0 flex-1 gap-0 py-0 rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
        {/* Filter bar skeleton */}
        <div className="border-border border-b p-4">
          <div className="flex items-center gap-3">
            <Skeleton className="h-9 w-64" />
            <Skeleton className="h-9 w-24" />
            <Skeleton className="h-9 w-24" />
          </div>
        </div>

        {/* Table skeleton */}
        <div className="p-4">
          {/* Table header skeleton */}
          <div className="border-border mb-4 flex items-center gap-4 border-b pb-3">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <Skeleton
                key={i}
                className="h-4 flex-1"
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
                  <Skeleton
                    key={j}
                    className="h-6 flex-1"
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
