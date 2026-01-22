/**
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION. All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Resources Page Skeleton
 *
 * Loading skeleton for the resources page.
 */

import { Skeleton } from "@/components/shadcn/skeleton";
import { TableSkeleton } from "@/components/data-table/TableSkeleton";

export function ResourcesPageSkeleton() {
  return (
    <div className="flex h-full flex-col gap-4 p-6">
      {/* Toolbar skeleton */}
      <div className="flex shrink-0 items-center justify-between">
        <Skeleton className="h-10 w-80" />
        <div className="flex items-center gap-2">
          <Skeleton className="h-9 w-24" />
          <Skeleton className="h-9 w-9" />
        </div>
      </div>

      {/* Summary cards skeleton */}
      <div className="flex shrink-0 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton
            key={i}
            className="h-20 flex-1 rounded-lg"
          />
        ))}
      </div>

      {/* Table skeleton */}
      <div className="min-h-0 flex-1 rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
        <TableSkeleton
          columnCount={5}
          rowCount={10}
          showHeader={true}
        />
      </div>
    </div>
  );
}
