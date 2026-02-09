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
 */

import { Skeleton } from "@/components/shadcn/skeleton";

export function DatasetDetailSkeleton() {
  return (
    <div className="flex flex-col gap-6 p-6">
      {/* Header skeleton */}
      <div className="flex items-center gap-4">
        <Skeleton className="h-10 w-10" />
        <div className="flex-1">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="mt-2 h-4 w-96" />
        </div>
      </div>

      {/* Tabs skeleton */}
      <div>
        <Skeleton className="h-10 w-64" />
        <div className="mt-6 grid gap-4">
          <Skeleton className="h-48" />
          <Skeleton className="h-48" />
        </div>
      </div>
    </div>
  );
}
