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

"use client";

/**
 * Workflow Detail Page Skeleton
 *
 * Loading skeleton for the workflow detail page.
 * Shows a placeholder for either the DAG canvas or table view with panel.
 */

import { Skeleton } from "@/components/shadcn/skeleton";
import { TableSkeleton } from "@/components/data-table/TableSkeleton";
import { useDagVisible } from "@/stores/shared-preferences-store";

export function WorkflowDetailSkeleton() {
  const dagVisible = useDagVisible();

  return (
    <div className="flex h-full">
      {!dagVisible ? (
        <>
          {/* Table View Area */}
          <div className="flex flex-1 flex-col gap-4 bg-zinc-50 p-6 dark:bg-zinc-950">
            {/* Toolbar skeleton */}
            <div className="flex shrink-0 items-center justify-between">
              <Skeleton className="h-10 w-80" />
              <div className="flex items-center gap-2">
                <Skeleton className="h-9 w-9" />
                <Skeleton className="h-9 w-9" />
              </div>
            </div>

            {/* Table skeleton */}
            <div className="min-h-0 flex-1 rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
              <TableSkeleton
                columnCount={6}
                rowCount={10}
                showHeader={true}
              />
            </div>
          </div>
        </>
      ) : (
        <>
          {/* DAG Canvas Area */}
          <div className="flex flex-1 items-center justify-center bg-zinc-50 dark:bg-zinc-950">
            <div className="text-center">
              <Skeleton className="mx-auto mb-4 h-32 w-32 rounded-lg" />
              <Skeleton className="mx-auto h-4 w-32" />
            </div>
          </div>
        </>
      )}

      {/* Panel Area */}
      <div className="w-[400px] shrink-0 border-l border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
        {/* Panel Header */}
        <div className="mb-6 space-y-2">
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-32" />
        </div>

        {/* Panel Content */}
        <div className="space-y-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="space-y-2"
            >
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-5 w-full" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
