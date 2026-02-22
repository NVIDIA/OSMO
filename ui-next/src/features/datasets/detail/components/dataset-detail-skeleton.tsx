//SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION. All rights reserved.

//Licensed under the Apache License, Version 2.0 (the "License");
//you may not use this file except in compliance with the License.
//You may obtain a copy of the License at

//http://www.apache.org/licenses/LICENSE-2.0

//Unless required by applicable law or agreed to in writing, software
//distributed under the License is distributed on an "AS IS" BASIS,
//WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//See the License for the specific language governing permissions and
//limitations under the License.

//SPDX-License-Identifier: Apache-2.0

/**
 * Dataset Detail Loading Skeleton
 *
 * Displays while dataset detail data is being fetched on the server.
 * Matches the file browser layout: sticky header + table rows.
 */

import { Skeleton } from "@/components/shadcn/skeleton";

export function DatasetDetailSkeleton() {
  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header bar skeleton */}
      <div className="flex shrink-0 items-center justify-between border-b border-zinc-200 px-4 py-2 dark:border-zinc-800">
        <Skeleton className="h-7 w-64" />
        <Skeleton className="h-7 w-20" />
      </div>

      {/* Table row skeletons */}
      <div className="flex-1">
        {Array.from({ length: 12 }).map((_, i) => (
          <div
            key={i}
            className="flex items-center gap-3 border-b border-zinc-100 px-4 py-3 dark:border-zinc-800"
          >
            <Skeleton className="size-4 shrink-0" />
            <Skeleton className="h-4 w-48" />
            <Skeleton className="ml-auto h-4 w-16" />
            <Skeleton className="h-4 w-24" />
          </div>
        ))}
      </div>
    </div>
  );
}
