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
 * Workflows Page Skeleton
 *
 * Loading skeleton for the workflows page.
 */

import { Skeleton } from "@/components/shadcn/skeleton";

export function WorkflowsPageSkeleton() {
  return (
    <div className="flex h-full flex-col gap-4 p-6">
      {/* Toolbar skeleton */}
      <div className="flex shrink-0 items-center justify-between">
        <Skeleton className="h-10 w-80" />
        <div className="flex items-center gap-2">
          <Skeleton className="h-9 w-32" />
          <Skeleton className="h-9 w-9" />
          <Skeleton className="h-9 w-9" />
        </div>
      </div>

      {/* Table skeleton */}
      <div className="min-h-0 flex-1 rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
        {/* Header */}
        <div className="flex h-11 items-center border-b border-zinc-200 px-4 dark:border-zinc-800">
          <Skeleton className="h-4 w-6" />
          <div className="ml-4 flex flex-1 gap-4">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-4 w-32" />
          </div>
        </div>

        {/* Rows */}
        {Array.from({ length: 12 }).map((_, i) => (
          <div
            key={i}
            className="flex h-12 items-center border-b border-zinc-100 px-4 last:border-b-0 dark:border-zinc-800/50"
          >
            <Skeleton className="h-4 w-4" />
            <div className="ml-4 flex flex-1 gap-4">
              <Skeleton className="h-4 w-44" />
              <Skeleton className="h-5 w-20 rounded-full" />
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-4 w-28" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
