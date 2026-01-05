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
      className="flex h-full flex-col gap-6 contain-layout"
      role="status"
      aria-label="Loading content"
    >
      {/* Page header skeleton - matches actual header dimensions */}
      <div className="shrink-0 space-y-2">
        <div className="skeleton-shimmer h-8 w-48 rounded" />
        <div className="skeleton-shimmer h-4 w-72 rounded" />
      </div>

      {/* Main content skeleton - fills remaining space */}
      <div className="contain-layout-paint min-h-0 flex-1 rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
        {/* Filter bar skeleton */}
        <div className="border-b border-zinc-100 p-4 dark:border-zinc-800/50">
          <div className="flex items-center gap-3">
            <div className="skeleton-shimmer h-9 w-64 rounded" />
            <div className="skeleton-shimmer h-9 w-24 rounded" />
            <div className="skeleton-shimmer h-9 w-24 rounded" />
          </div>
        </div>

        {/* Table skeleton */}
        <div className="p-4">
          {/* Table header skeleton */}
          <div className="mb-4 flex items-center gap-4 border-b border-zinc-100 pb-3 dark:border-zinc-800/50">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <div
                key={i}
                className="skeleton-shimmer h-4 flex-1 rounded"
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
                    className="skeleton-shimmer h-6 flex-1 rounded"
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
