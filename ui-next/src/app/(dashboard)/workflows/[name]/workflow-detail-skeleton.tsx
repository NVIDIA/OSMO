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
 * Workflow Detail Page Skeleton
 *
 * Loading skeleton for the workflow detail page.
 * Shows a placeholder for the DAG canvas and panel.
 */

import { Skeleton } from "@/components/shadcn/skeleton";

export function WorkflowDetailSkeleton() {
  return (
    <div className="flex h-full">
      {/* DAG Canvas Area */}
      <div className="flex flex-1 items-center justify-center bg-zinc-50 dark:bg-zinc-950">
        <div className="text-center">
          <Skeleton className="mx-auto mb-4 h-32 w-32 rounded-lg" />
          <Skeleton className="mx-auto h-4 w-32" />
        </div>
      </div>

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
