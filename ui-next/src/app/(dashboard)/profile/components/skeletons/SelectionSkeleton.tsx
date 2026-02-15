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

import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/shadcn/card";
import { Skeleton } from "@/components/shadcn/skeleton";

interface SelectionSkeletonProps {
  /** Number of list items to render. Defaults to 4. */
  itemCount?: number;
}

export function SelectionSkeleton({ itemCount = 4 }: SelectionSkeletonProps) {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Loading selection card"
    >
      <Card
        data-variant="sectioned"
        className="flex flex-col"
        style={{ height: "var(--profile-selection-card-height)" }}
      >
        {/* Header: icon + title + count badge + description */}
        <CardHeader className="shrink-0 border-b">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Skeleton className="size-5 rounded" />
            <Skeleton className="h-5 w-20" />
            <Skeleton className="ml-1 h-5 w-24 rounded-full" />
          </CardTitle>
          <CardDescription>
            <Skeleton className="h-4 w-72" />
          </CardDescription>
        </CardHeader>

        {/* Content: search + list */}
        <CardContent className="flex-1 overflow-hidden">
          <div className="flex h-full flex-col">
            {/* Search input skeleton */}
            <div className="search-input-container bg-background mb-4 shrink-0">
              <Skeleton className="size-4 shrink-0 rounded" />
              <Skeleton className="h-4 flex-1" />
            </div>

            {/* List items */}
            <div className="border-border bg-muted max-h-full overflow-hidden rounded-md border">
              <div className="flex flex-col">
                {Array.from({ length: itemCount }).map((_, i) => (
                  <div
                    key={i}
                    className="bg-background border-border flex items-center justify-between border-b px-4 py-3 last:border-b-0"
                  >
                    <div className="flex items-center gap-3">
                      {/* Radio circle */}
                      <Skeleton className="size-4 shrink-0 rounded-full" />
                      <div className="flex flex-col gap-0.5">
                        <Skeleton className="h-4 w-40" />
                        {/* First item shows subtitle */}
                        {i === 0 && <Skeleton className="h-3 w-24" />}
                      </div>
                    </div>
                    {/* First item shows "Default" badge */}
                    {i === 0 && <Skeleton className="h-5 w-14 rounded" />}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </CardContent>

        {/* Footer: Reset + Save buttons */}
        <CardFooter className="shrink-0 border-t">
          <div className="flex w-full items-center justify-end gap-3">
            <Skeleton className="h-9 w-16 rounded-md" />
            <Skeleton className="h-9 w-14 rounded-md" />
          </div>
        </CardFooter>
      </Card>
    </div>
  );
}
